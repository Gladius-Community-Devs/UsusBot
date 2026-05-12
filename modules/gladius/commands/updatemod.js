const { SlashCommandBuilder } = require('discord.js');
const {
    getModdersFilePath,
    getModNamesForDiscordId,
    normalizeModNames,
    readModders
} = require('../modders_store');

function hasRole(interaction, roleName) {
    return interaction.member.roles.cache.some(role => role.name === roleName);
}

function getAllModNames(config) {
    return [...new Set(Object.values(config).flatMap(normalizeModNames))];
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('updatemod')
        .setDescription('(MODDER or ADMIN OVERRIDE) Apply an xdelta patch to vanilla.iso and unpack mod files')
        .addAttachmentOption(option =>
            option.setName('patch')
                .setDescription('The .xdelta or .xdelta3 patch file to apply')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('override')
                .setDescription('(ADMIN ONLY) Allow updating a specific mod you do not own')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('mod_name')
                .setDescription('Target mod (required for admin override or if you own multiple mods)')
                .setAutocomplete(true)
                .setRequired(false)),
    name: 'updatemod',
    has_state: false,
    needs_api: false,
    async autocomplete(interaction) {
        const focusedValue = (interaction.options.getFocused() || '').toLowerCase();

        try {
            const config = readModders();
            const hasAdminRole = hasRole(interaction, 'Admin');
            const useOverride = hasAdminRole && (interaction.options.getBoolean('override') ?? false);
            const availableMods = useOverride
                ? getAllModNames(config)
                : getModNamesForDiscordId(config, interaction.user.id);

            const filtered = availableMods
                .filter(modName => modName.toLowerCase().includes(focusedValue))
                .slice(0, 25)
                .map(modName => ({ name: modName, value: modName }));

            await interaction.respond(filtered);
        } catch (error) {
            this.logger.error('Failed to build updatemod autocomplete results:', error);
            await interaction.respond([]);
        }
    },
    async execute(interaction, extra) {
        const fs = require('fs');
        const path = require('path');
        const axios = require('axios');
        const { spawn } = require('child_process');

        const safeSerialize = (value) => {
            try {
                return JSON.stringify(value);
            } catch (error) {
                return JSON.stringify({ serializationError: error.message });
            }
        };

        const summarizeText = (value, maxLength = 1200) => {
            if (!value) return null;
            const normalized = String(value).replace(/\s+/g, ' ').trim();
            if (!normalized) return null;
            return normalized.length > maxLength
                ? `${normalized.slice(0, maxLength)}...(+${normalized.length - maxLength} chars)`
                : normalized;
        };

        const formatError = (error) => error?.stack || error?.message || String(error);

        const baseLogContext = {
            command: 'updatemod',
            guildId: interaction.guildId || null,
            channelId: interaction.channelId || null,
            userId: interaction.user?.id || null
        };

        const logWithContext = (level, message, extraContext = {}) => {
            const loggerMethod = this.logger && typeof this.logger[level] === 'function'
                ? this.logger[level].bind(this.logger)
                : this.logger && typeof this.logger.info === 'function'
                    ? this.logger.info.bind(this.logger)
                    : null;

            if (!loggerMethod) return;

            loggerMethod(`[updatemod] ${message} | ${safeSerialize({ ...baseLogContext, ...extraContext })}`);
        };

        const attachment = interaction.options.getAttachment('patch');
        const requestedModName = interaction.options.getString('mod_name');
        let activeModName = requestedModName || null;

        // Defer immediately — processing can take a long time
        await interaction.deferReply();

        // Helper: update the deferred reply with a status message
        const setStatus = async (text) => {
            logWithContext('info', 'Status update', {
                modName: activeModName,
                status: text
            });
            try {
                await interaction.editReply({ content: text });
            } catch (error) {
                this.logger.error('Failed to update updatemod status reply:', error);
            }
        };

        // Python launcher detection (Windows uses py -3, others use python3)
        const isWin = process.platform === 'win32';
        const pythonCmd = isWin ? 'py' : 'python3';
        const pythonBaseArgs = isWin ? ['-3'] : [];

        // 1. Check role
        const hasAdminRole = hasRole(interaction, 'Admin');
        const hasModderRole = hasRole(interaction, 'Modder');
        const overrideRequested = interaction.options.getBoolean('override') ?? false;

        logWithContext('info', 'Received update request', {
            requestedModName,
            overrideRequested,
            hasAdminRole,
            hasModderRole,
            attachmentName: attachment?.name || null,
            attachmentSize: attachment?.size ?? null
        });

        if (overrideRequested && !hasAdminRole) {
            logWithContext('warn', 'Rejected override request from non-admin user', {
                requestedModName,
                attachmentName: attachment?.name || null
            });
            await setStatus('The override flag is only available to users with the Admin role.');
            return;
        }

        const useOverride = hasAdminRole && overrideRequested;
        if (!hasModderRole && !useOverride) {
            logWithContext('warn', 'Rejected update request due to missing permissions', {
                requestedModName,
                attachmentName: attachment?.name || null
            });
            await setStatus('You do not have permission to use this command. (Modder role required, or Admin with override enabled)');
            return;
        }

        // 2. Validate attachment
        if (!attachment.name.toLowerCase().endsWith('.xdelta') && !attachment.name.toLowerCase().endsWith('.xdelta3')) {
            logWithContext('warn', 'Rejected patch with unsupported extension', {
                requestedModName,
                attachmentName: attachment.name
            });
            await setStatus('Attached file must end with .xdelta or .xdelta3.');
            return;
        }

        try {
            // 3. Determine target mod name for user from shared modders file
            const moddersFilePath = getModdersFilePath();
            const config = readModders();
            let modDisplayName = null;

            logWithContext('info', 'Loaded shared modders configuration', {
                moddersFilePath,
                requestedModName,
                useOverride
            });

            if (useOverride) {
                if (!requestedModName) {
                    logWithContext('warn', 'Admin override missing target mod name', {
                        moddersFilePath
                    });
                    await setStatus('Admin override requires mod_name. Re-run the command and select the mod to update.');
                    return;
                }

                const allMods = getAllModNames(config);
                modDisplayName = allMods.find(mod => mod.toLowerCase() === requestedModName.toLowerCase()) || null;
                if (!modDisplayName) {
                    logWithContext('warn', 'Requested override target was not found in modders list', {
                        requestedModName,
                        moddersFilePath
                    });
                    await setStatus(`Mod '${requestedModName}' was not found in the shared modders list (${moddersFilePath}).`);
                    return;
                }
            } else {
                const modderId = interaction.user.id;
                const ownedMods = getModNamesForDiscordId(config, modderId);
                if (!ownedMods.length) {
                    logWithContext('warn', 'User is not registered in modders list', {
                        moddersFilePath
                    });
                    await setStatus(`You are not listed in the shared modders list (${moddersFilePath}). Ask an admin to register your mod.`);
                    return;
                }

                if (requestedModName) {
                    modDisplayName = ownedMods.find(mod => mod.toLowerCase() === requestedModName.toLowerCase()) || null;
                    if (!modDisplayName) {
                        logWithContext('warn', 'User requested a mod they do not own', {
                            requestedModName,
                            ownedMods
                        });
                        await setStatus(`You do not own mod '${requestedModName}'. Owned mods: ${ownedMods.join(', ')}`);
                        return;
                    }
                } else if (ownedMods.length === 1) {
                    modDisplayName = ownedMods[0];
                } else {
                    logWithContext('warn', 'User owns multiple mods and did not choose one', {
                        ownedMods
                    });
                    await setStatus(`You own multiple mods. Re-run with mod_name set to one of: ${ownedMods.join(', ')}`);
                    return;
                }
            }

            activeModName = modDisplayName;
            logWithContext('info', 'Resolved target mod for update request', {
                requestedModName,
                modDisplayName,
                useOverride
            });

            this.logger.info(`Starting mod update for ${modDisplayName} requested by ${interaction.user.id}${useOverride ? ' with admin override' : ''}.`);
            const sanitizedModDisplayName = modDisplayName.replace(/\s+/g, '_');

            // Paths
            const uploadsRoot = path.join(__dirname, '../../../uploads');
            const gladiusDataRoot = process.env.GLADIUS_DATA_ROOT || process.env.GLADIUS_GAME_DATA_PATH;
            if (!gladiusDataRoot || !gladiusDataRoot.trim()) {
                logWithContext('error', 'Missing configured Gladius data root', {
                    modDisplayName,
                    envGladiusDataRoot: process.env.GLADIUS_DATA_ROOT || null,
                    envGladiusGameDataPath: process.env.GLADIUS_GAME_DATA_PATH || null
                });
                await setStatus('GLADIUS_DATA_ROOT is not set in the bot environment.');
                return;
            }
            const vanillaIsoPath = path.join(uploadsRoot, 'vanilla.iso');
            if (!fs.existsSync(vanillaIsoPath)) {
                logWithContext('error', 'Missing vanilla ISO before patch apply', {
                    modDisplayName,
                    vanillaIsoPath
                });
                await setStatus('vanilla.iso not found in uploads folder. Notify an admin.');
                return;
            }
            const modFolder = path.join(uploadsRoot, sanitizedModDisplayName);
            if (!fs.existsSync(modFolder)) {
                fs.mkdirSync(modFolder, { recursive: true });
                logWithContext('info', 'Created mod upload folder', {
                    modDisplayName,
                    modFolder
                });
            }

            // File destinations
            const patchFilePath = path.join(modFolder, 'patch.xdelta');
            const workingVanillaPath = path.join(modFolder, 'vanilla.iso');
            const outputIsoPath = path.join(modFolder, sanitizedModDisplayName + '_modded.iso');

            logWithContext('info', 'Resolved update paths', {
                modDisplayName,
                uploadsRoot,
                gladiusDataRoot,
                vanillaIsoPath,
                modFolder,
                patchFilePath,
                workingVanillaPath,
                outputIsoPath
            });

            // Clean previous artifacts
            const removedArtifacts = [];
            for (const artifactPath of [patchFilePath, workingVanillaPath, outputIsoPath]) {
                if (!fs.existsSync(artifactPath)) continue;
                fs.unlinkSync(artifactPath);
                removedArtifacts.push(artifactPath);
            }

            if (removedArtifacts.length) {
                logWithContext('info', 'Removed stale artifacts before update', {
                    modDisplayName,
                    removedArtifacts
                });
            }

            await setStatus('Downloading patch and preparing to apply...');

            // Download patch attachment
            logWithContext('info', 'Downloading patch attachment', {
                modDisplayName,
                attachmentName: attachment.name,
                patchFilePath
            });
            const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
            const patchBuffer = Buffer.from(response.data);
            fs.writeFileSync(patchFilePath, patchBuffer);
            logWithContext('info', 'Downloaded patch attachment', {
                modDisplayName,
                attachmentName: attachment.name,
                patchBytes: patchBuffer.length,
                patchFilePath
            });

            // Copy vanilla.iso
            logWithContext('info', 'Copying vanilla ISO into working location', {
                modDisplayName,
                source: vanillaIsoPath,
                destination: workingVanillaPath
            });
            fs.copyFileSync(vanillaIsoPath, workingVanillaPath);
            logWithContext('info', 'Copied vanilla ISO into working location', {
                modDisplayName,
                destination: workingVanillaPath
            });

            const xdeltaExe = 'xdelta3';
            // Command: xdelta3 -d -s source patch output
            const argsList = ['-d', '-s', workingVanillaPath, patchFilePath, outputIsoPath];
            logWithContext('info', 'Launching xdelta3 patch process', {
                modDisplayName,
                executable: xdeltaExe,
                argsList
            });
            const proc = spawn(xdeltaExe, argsList, { windowsHide: true });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', d => { stdout += d.toString(); });
            proc.stderr.on('data', d => { stderr += d.toString(); });
            proc.on('error', error => {
                logWithContext('error', 'Failed to start xdelta3 process', {
                    modDisplayName,
                    executable: xdeltaExe,
                    argsList,
                    error: formatError(error)
                });
                this.logger.error('Failed to start xdelta3 process:', error);
                setStatus('Failed to start xdelta3. Is it installed on the server?');
            });
            proc.on('close', code => {
                const outputIsoExists = fs.existsSync(outputIsoPath);
                logWithContext(code === 0 && outputIsoExists ? 'info' : 'error', 'xdelta3 process completed', {
                    modDisplayName,
                    code,
                    outputIsoPath,
                    outputIsoExists,
                    ...(summarizeText(stdout) ? { stdout: summarizeText(stdout) } : {}),
                    ...(summarizeText(stderr) ? { stderr: summarizeText(stderr) } : {})
                });

                if (code === 0 && outputIsoExists) {
                    // Prefer the shared game-data tools directory, but keep the legacy uploads/tools fallback.
                    const toolsDirCandidates = [
                        path.join(gladiusDataRoot, 'tools'),
                        path.join(uploadsRoot, 'tools')
                    ];
                    const toolsDir = toolsDirCandidates.find(candidateDir => {
                        const isoToolPath = path.join(candidateDir, 'ngciso-tool-gc.py');
                        const becToolPath = path.join(candidateDir, 'bec-tool-all.py');
                        return fs.existsSync(isoToolPath) && fs.existsSync(becToolPath);
                    });

                    if (!toolsDir) {
                        logWithContext('error', 'Failed to resolve extraction tools directory', {
                            modDisplayName,
                            toolsDirCandidates
                        });
                        setStatus('Tools or required scripts missing. Skipping unpack.');
                        return;
                    }

                    const isoTool = path.join(toolsDir, 'ngciso-tool-gc.py');
                    const becTool = path.join(toolsDir, 'bec-tool-all.py');
                    const fileListCandidates = [
                        path.join(toolsDir, `${sanitizedModDisplayName}_FileList.txt`),
                        path.join(uploadsRoot, 'tools', `${sanitizedModDisplayName}_FileList.txt`)
                    ];
                    const fileList = fileListCandidates.find(candidatePath => fs.existsSync(candidatePath)) || fileListCandidates[0];

                    logWithContext('info', 'Resolved extraction tool paths', {
                        modDisplayName,
                        toolsDirCandidates,
                        toolsDir,
                        isoTool,
                        becTool,
                        fileList,
                        fileListExists: fs.existsSync(fileList)
                    });

                    const isoUnpackDir = path.join(modFolder, 'iso_unpacked');
                    const becUnpackDir = path.join(modFolder, 'bec_unpacked');
                    const isoUnpackDirArg = isoUnpackDir.endsWith(path.sep) ? isoUnpackDir : isoUnpackDir + path.sep;
                    const becUnpackDirArg = becUnpackDir.endsWith(path.sep) ? becUnpackDir : becUnpackDir + path.sep;
                    if (fs.existsSync(isoUnpackDir)) fs.rmSync(isoUnpackDir, { recursive: true, force: true });
                    if (fs.existsSync(becUnpackDir)) fs.rmSync(becUnpackDir, { recursive: true, force: true });
                    fs.mkdirSync(isoUnpackDir, { recursive: true });
                    fs.mkdirSync(becUnpackDir, { recursive: true });

                    logWithContext('info', 'Prepared unpack directories', {
                        modDisplayName,
                        isoUnpackDir,
                        becUnpackDir
                    });

                    const runScript = (label, scriptPath, scriptArgs, opts={}) => new Promise((resolve, reject) => {
                        logWithContext('info', `Launching ${label}`, {
                            modDisplayName,
                            scriptPath,
                            scriptArgs,
                            cwd: toolsDir
                        });

                        const p = spawn(pythonCmd, [...pythonBaseArgs, scriptPath, ...scriptArgs], { cwd: toolsDir, ...opts });
                        let outBuf = '';
                        let errBuf = '';
                        p.stdout.on('data', d => outBuf += d.toString());
                        p.stderr.on('data', d => errBuf += d.toString());
                        p.on('error', e => {
                            logWithContext('error', `${label} process failed to start`, {
                                modDisplayName,
                                scriptPath,
                                scriptArgs,
                                error: formatError(e)
                            });
                            reject(e);
                        });
                        p.on('close', c => {
                            const scriptLogContext = {
                                modDisplayName,
                                scriptPath,
                                scriptArgs,
                                exitCode: c,
                                ...(summarizeText(outBuf) ? { stdout: summarizeText(outBuf) } : {}),
                                ...(summarizeText(errBuf) ? { stderr: summarizeText(errBuf) } : {})
                            };

                            if (c === 0) {
                                logWithContext('info', `${label} completed`, scriptLogContext);
                                resolve();
                                return;
                            }

                            logWithContext('error', `${label} failed`, scriptLogContext);
                            reject(new Error(errBuf || ('exit code ' + c)));
                        });
                    });

                    const waitForFile = (p, timeoutMs=5000, intervalMs=200) => new Promise((resolve, reject) => {
                        logWithContext('info', 'Waiting for expected file', {
                            modDisplayName,
                            filePath: p,
                            timeoutMs,
                            intervalMs
                        });

                        const deadline = Date.now() + timeoutMs;
                        const poll = () => {
                            if (fs.existsSync(p)) {
                                logWithContext('info', 'Detected expected file', {
                                    modDisplayName,
                                    filePath: p
                                });
                                return resolve();
                            }
                            if (Date.now() > deadline) {
                                const timeoutError = new Error('Timed out waiting for file: ' + p);
                                logWithContext('error', 'Timed out waiting for expected file', {
                                    modDisplayName,
                                    filePath: p,
                                    timeoutMs
                                });
                                return reject(timeoutError);
                            }
                            setTimeout(poll, intervalMs);
                        };
                        poll();
                    });

                    waitForFile(outputIsoPath)
                        .then(() => setStatus('Unpacking patched ISO...'))
                        .then(() => runScript('ISO unpack tool', isoTool, ['-unpack', outputIsoPath, isoUnpackDirArg, fileList]))
                        .then(() => {
                            const becFile = path.join(isoUnpackDir, 'gladius.bec');
                            if (!fs.existsSync(becFile)) {
                                logWithContext('error', 'ISO unpack completed without gladius.bec', {
                                    modDisplayName,
                                    becFile,
                                    isoUnpackDir
                                });
                                setStatus('gladius.bec not found after ISO unpack. Cannot proceed to BEC unpack.');
                                return Promise.reject(new Error('Missing gladius.bec'));
                            }
                            logWithContext('info', 'ISO unpack produced gladius.bec', {
                                modDisplayName,
                                becFile
                            });
                            return setStatus('ISO unpack complete. Unpacking gladius.bec...')
                                .then(() => runScript('BEC unpack tool', becTool, ['-unpack', becFile, becUnpackDirArg]));
                        })
                        .then(() => {
                            const unpackedDataDir = path.join(becUnpackDir, 'data');
                            if (!fs.existsSync(unpackedDataDir)) {
                                logWithContext('error', 'BEC unpack completed without data directory', {
                                    modDisplayName,
                                    unpackedDataDir,
                                    becUnpackDir
                                });
                                setStatus('BEC unpack finished but data folder not found.');
                                return;
                            }

                            // Keep bot-local data and central site data in sync.
                            const finalDataDir = path.join(modFolder, 'data');
                            if (fs.existsSync(finalDataDir)) fs.rmSync(finalDataDir, { recursive: true, force: true });
                            logWithContext('info', 'Moving unpacked data into mod folder', {
                                modDisplayName,
                                unpackedDataDir,
                                finalDataDir
                            });
                            try {
                                fs.renameSync(unpackedDataDir, finalDataDir);
                                logWithContext('info', 'Moved unpacked data with rename', {
                                    modDisplayName,
                                    source: unpackedDataDir,
                                    destination: finalDataDir
                                });
                            } catch (e) {
                                logWithContext('warn', 'Rename failed; falling back to copy for unpacked data', {
                                    modDisplayName,
                                    source: unpackedDataDir,
                                    destination: finalDataDir,
                                    error: formatError(e)
                                });
                                try {
                                    fs.cpSync(unpackedDataDir, finalDataDir, { recursive: true });
                                    fs.rmSync(unpackedDataDir, { recursive: true, force: true });
                                    logWithContext('info', 'Copied unpacked data after rename failure', {
                                        modDisplayName,
                                        source: unpackedDataDir,
                                        destination: finalDataDir
                                    });
                                } catch (copyErr) {
                                    logWithContext('error', 'Failed to copy unpacked data after rename failure', {
                                        modDisplayName,
                                        source: unpackedDataDir,
                                        destination: finalDataDir,
                                        error: formatError(copyErr)
                                    });
                                    this.logger.error('Data move error:', copyErr);
                                }
                            }

                            const centralModDir = path.join(gladiusDataRoot, sanitizedModDisplayName);
                            const centralDataDir = path.join(centralModDir, 'data');
                            let centralSyncError = null;
                            logWithContext('info', 'Syncing unpacked data to shared Gladius data root', {
                                modDisplayName,
                                finalDataDir,
                                centralModDir,
                                centralDataDir
                            });
                            try {
                                fs.mkdirSync(centralModDir, { recursive: true });
                                if (fs.existsSync(centralDataDir)) {
                                    fs.rmSync(centralDataDir, { recursive: true, force: true });
                                }
                                fs.cpSync(finalDataDir, centralDataDir, { recursive: true });
                                logWithContext('info', 'Synced unpacked data to shared Gladius data root', {
                                    modDisplayName,
                                    centralDataDir
                                });
                            } catch (syncErr) {
                                centralSyncError = syncErr;
                                logWithContext('error', 'Failed to sync unpacked data to shared Gladius data root', {
                                    modDisplayName,
                                    centralDataDir,
                                    error: formatError(syncErr)
                                });
                                this.logger.error('Central data sync error:', syncErr);
                            }

                            try {
                                const removedEntries = [];
                                for (const entry of fs.readdirSync(modFolder)) {
                                    if (entry !== 'data') {
                                        fs.rmSync(path.join(modFolder, entry), { recursive: true, force: true });
                                        removedEntries.push(entry);
                                    }
                                }
                                logWithContext('info', 'Cleaned temporary mod artifacts after sync', {
                                    modDisplayName,
                                    modFolder,
                                    removedEntries
                                });
                            } catch (cleanErr) {
                                logWithContext('error', 'Failed to clean temporary mod artifacts', {
                                    modDisplayName,
                                    modFolder,
                                    error: formatError(cleanErr)
                                });
                                this.logger.error('Cleanup error:', cleanErr);
                            }

                            if (centralSyncError) {
                                logWithContext('warn', 'Completed local update but shared sync failed', {
                                    modDisplayName,
                                    centralModDir,
                                    error: formatError(centralSyncError)
                                });
                                setStatus(`Backend updated locally, but failed to sync to ${centralModDir}: ${centralSyncError.message}`);
                            } else {
                                logWithContext('info', 'Completed mod update and shared sync', {
                                    modDisplayName,
                                    centralModDir
                                });
                                this.logger.info(`Completed mod update for ${modDisplayName}; synced data to ${centralModDir}.`);
                                setStatus(`Backend updated and synced to ${centralModDir}`);
                            }
                        })
                        .catch(err => {
                            logWithContext('error', 'Unpack pipeline failed', {
                                modDisplayName,
                                error: formatError(err)
                            });
                            this.logger.error('Unpack error:', err);
                            setStatus('An error occurred during unpack: ' + err.message);
                        });
                } else {
                    logWithContext('error', 'Patch application failed', {
                        modDisplayName,
                        outputIsoPath,
                        code,
                        stderr: summarizeText(stderr),
                        stdout: summarizeText(stdout)
                    });
                    this.logger.error('xdelta3 failed', stderr || ('exit code ' + code));
                    setStatus('Patch application failed. Check that the patch matches vanilla.iso.');
                }
            });
        } catch (err) {
            logWithContext('error', 'Unhandled error while processing mod update', {
                modName: activeModName,
                requestedModName,
                attachmentName: attachment?.name || null,
                error: formatError(err)
            });
            this.logger.error('Error updating mod:', err);
            await setStatus('An error occurred while processing the patch.');
        }
    }
};