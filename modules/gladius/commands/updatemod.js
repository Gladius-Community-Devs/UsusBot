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
            this.logger.error(`Failed to build updatemod autocomplete results: ${error?.stack || error?.message || error}`);
            await interaction.respond([]);
        }
    },
    async execute(interaction, extra) {
        const fs = require('fs');
        const path = require('path');
        const axios = require('axios');
        const { spawn } = require('child_process');

        const attachment = interaction.options.getAttachment('patch');
        const requestedModName = interaction.options.getString('mod_name');
        const userId = interaction.user?.id || 'unknown';
        const attachmentName = attachment?.name || 'unknown';
        let activeModName = requestedModName || null;

        // Defer immediately — processing can take a long time
        await interaction.deferReply();

        // Helper: update the deferred reply with a status message
        const setStatus = async (text) => {
            try {
                await interaction.editReply({ content: text });
            } catch (error) {
                this.logger.error(`Failed to update updatemod status reply: ${error?.stack || error?.message || error}`);
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

        this.logger.info(
            `updatemod request from ${userId}: mod=${requestedModName || '(auto)'}, override=${overrideRequested}, ` +
            `admin=${hasAdminRole}, modder=${hasModderRole}, attachment=${attachmentName}`
        );

        if (overrideRequested && !hasAdminRole) {
            this.logger.warn(`updatemod rejected for ${userId}: override requested without Admin role.`);
            await setStatus('The override flag is only available to users with the Admin role.');
            return;
        }

        const useOverride = hasAdminRole && overrideRequested;
        if (!hasModderRole && !useOverride) {
            this.logger.warn(`updatemod rejected for ${userId}: missing Modder role and no admin override.`);
            await setStatus('You do not have permission to use this command. (Modder role required, or Admin with override enabled)');
            return;
        }

        // 2. Validate attachment
        if (!attachment.name.toLowerCase().endsWith('.xdelta') && !attachment.name.toLowerCase().endsWith('.xdelta3')) {
            this.logger.warn(`updatemod rejected for ${userId}: unsupported patch extension on ${attachment.name}.`);
            await setStatus('Attached file must end with .xdelta or .xdelta3.');
            return;
        }

        try {
            // 3. Determine target mod name for user from shared modders file
            const moddersFilePath = getModdersFilePath();
            const config = readModders();
            let modDisplayName = null;

            if (useOverride) {
                if (!requestedModName) {
                    this.logger.warn(`updatemod rejected for ${userId}: admin override requested without mod_name.`);
                    await setStatus('Admin override requires mod_name. Re-run the command and select the mod to update.');
                    return;
                }

                const allMods = getAllModNames(config);
                modDisplayName = allMods.find(mod => mod.toLowerCase() === requestedModName.toLowerCase()) || null;
                if (!modDisplayName) {
                    this.logger.warn(`updatemod could not find override target "${requestedModName}" in ${moddersFilePath}.`);
                    await setStatus(`Mod '${requestedModName}' was not found in the shared modders list (${moddersFilePath}).`);
                    return;
                }
            } else {
                const modderId = interaction.user.id;
                const ownedMods = getModNamesForDiscordId(config, modderId);
                if (!ownedMods.length) {
                    this.logger.warn(`updatemod rejected for ${userId}: no owned mods listed in ${moddersFilePath}.`);
                    await setStatus(`You are not listed in the shared modders list (${moddersFilePath}). Ask an admin to register your mod.`);
                    return;
                }

                if (requestedModName) {
                    modDisplayName = ownedMods.find(mod => mod.toLowerCase() === requestedModName.toLowerCase()) || null;
                    if (!modDisplayName) {
                        this.logger.warn(`updatemod rejected for ${userId}: requested mod "${requestedModName}" is not owned by this user.`);
                        await setStatus(`You do not own mod '${requestedModName}'. Owned mods: ${ownedMods.join(', ')}`);
                        return;
                    }
                } else if (ownedMods.length === 1) {
                    modDisplayName = ownedMods[0];
                } else {
                    this.logger.warn(`updatemod rejected for ${userId}: multiple owned mods but no mod_name was provided.`);
                    await setStatus(`You own multiple mods. Re-run with mod_name set to one of: ${ownedMods.join(', ')}`);
                    return;
                }
            }

            activeModName = modDisplayName;
            this.logger.info(`Starting mod update for ${modDisplayName} requested by ${userId}${useOverride ? ' with admin override' : ''}.`);
            const sanitizedModDisplayName = modDisplayName.replace(/\s+/g, '_');

            // Paths
            const uploadsRoot = path.join(__dirname, '../../../uploads');
            const gladiusDataRoot = process.env.GLADIUS_DATA_ROOT || process.env.GLADIUS_GAME_DATA_PATH;
            if (!gladiusDataRoot || !gladiusDataRoot.trim()) {
                this.logger.error(`Cannot update ${modDisplayName}: GLADIUS_DATA_ROOT / GLADIUS_GAME_DATA_PATH is not configured.`);
                await setStatus('GLADIUS_DATA_ROOT is not set in the bot environment.');
                return;
            }
            const vanillaIsoPath = path.join(uploadsRoot, 'vanilla.iso');
            if (!fs.existsSync(vanillaIsoPath)) {
                this.logger.error(`Cannot update ${modDisplayName}: missing vanilla ISO at ${vanillaIsoPath}.`);
                await setStatus('vanilla.iso not found in uploads folder. Notify an admin.');
                return;
            }
            const modFolder = path.join(uploadsRoot, sanitizedModDisplayName);
            if (!fs.existsSync(modFolder)) {
                fs.mkdirSync(modFolder, { recursive: true });
                this.logger.info(`Created upload folder for ${modDisplayName} at ${modFolder}.`);
            }

            const toolsDirCandidates = [
                path.join(gladiusDataRoot, 'tools'),
                path.join(uploadsRoot, 'tools')
            ];
            const toolsDir = toolsDirCandidates.find(candidateDir => {
                const isoToolPath = path.join(candidateDir, 'ngciso-tool-gc.py');
                const becToolPath = path.join(candidateDir, 'bec-tool-all.py');
                const unitsIdxToolPath = path.join(candidateDir, 'Gladius_Units_IDX_Unpack.py');
                return fs.existsSync(isoToolPath) && fs.existsSync(becToolPath) && fs.existsSync(unitsIdxToolPath);
            });

            if (!toolsDir) {
                this.logger.error(`Cannot update ${modDisplayName}: required unpack tools were not found in ${toolsDirCandidates.join(' or ')}.`);
                await setStatus('Required unpack tools were not found. Check the shared tools directory configuration.');
                return;
            }

            const isoTool = path.join(toolsDir, 'ngciso-tool-gc.py');
            const becTool = path.join(toolsDir, 'bec-tool-all.py');
            const unitsIdxTool = path.join(toolsDir, 'Gladius_Units_IDX_Unpack.py');
            const fileListCandidates = [
                path.join(toolsDir, `${sanitizedModDisplayName}_FileList.txt`),
                path.join(uploadsRoot, 'tools', `${sanitizedModDisplayName}_FileList.txt`)
            ];
            const fileList = fileListCandidates.find(candidatePath => fs.existsSync(candidatePath));
            const requiredUnitFiles = ['gladiators.txt', 'statsets.txt', 'skillsets.txt', 'itemsets.txt'];

            if (!fileList) {
                this.logger.error(`Cannot update ${modDisplayName}: missing file list. Checked ${fileListCandidates.join(' and ')}.`);
                await setStatus(`Required file list for ${modDisplayName} was not found. Check the tools directory.`);
                return;
            }

            this.logger.info(`Preflight for ${modDisplayName}: tools=${toolsDir}, fileList=${fileList}.`);

            // File destinations
            const patchFilePath = path.join(modFolder, 'patch.xdelta');
            const workingVanillaPath = path.join(modFolder, 'vanilla.iso');
            const outputIsoPath = path.join(modFolder, sanitizedModDisplayName + '_modded.iso');
            this.logger.info(`Prepared paths for ${modDisplayName}: modFolder=${modFolder}, patch=${patchFilePath}, outputIso=${outputIsoPath}.`);

            // Clean previous artifacts
            const removedArtifacts = [];
            for (const artifactPath of [patchFilePath, workingVanillaPath, outputIsoPath]) {
                if (!fs.existsSync(artifactPath)) continue;
                fs.unlinkSync(artifactPath);
                removedArtifacts.push(artifactPath);
            }

            if (removedArtifacts.length) {
                this.logger.info(`Removed stale artifacts for ${modDisplayName}: ${removedArtifacts.join(', ')}.`);
            }

            await setStatus('Downloading patch and preparing to apply...');

            // Download patch attachment
            this.logger.info(`Downloading patch ${attachment.name} for ${modDisplayName}.`);
            const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
            const patchBuffer = Buffer.from(response.data);
            fs.writeFileSync(patchFilePath, patchBuffer);
            this.logger.info(`Saved patch for ${modDisplayName} to ${patchFilePath} (${patchBuffer.length} bytes).`);

            // Copy vanilla.iso
            fs.copyFileSync(vanillaIsoPath, workingVanillaPath);
            this.logger.info(`Copied vanilla ISO to ${workingVanillaPath} for ${modDisplayName}.`);

            const xdeltaExe = 'xdelta3';
            // Command: xdelta3 -d -s source patch output
            const argsList = ['-d', '-s', workingVanillaPath, patchFilePath, outputIsoPath];
            this.logger.info(`Running xdelta3 for ${modDisplayName}.`);
            const proc = spawn(xdeltaExe, argsList, { windowsHide: true });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', d => { stdout += d.toString(); });
            proc.stderr.on('data', d => { stderr += d.toString(); });
            proc.on('error', error => {
                this.logger.error(`Failed to start xdelta3 for ${modDisplayName}: ${error?.stack || error?.message || error}`);
                setStatus('Failed to start xdelta3. Is it installed on the server?');
            });
            proc.on('close', code => {
                const outputIsoExists = fs.existsSync(outputIsoPath);
                const stderrSummary = String(stderr || '').replace(/\s+/g, ' ').trim();
                const stdoutSummary = String(stdout || '').replace(/\s+/g, ' ').trim();

                if (code === 0 && outputIsoExists) {
                    this.logger.info(`xdelta3 completed for ${modDisplayName}; created ${outputIsoPath}.`);
                    const isoUnpackDir = path.join(modFolder, 'iso_unpacked');
                    const becUnpackDir = path.join(modFolder, 'bec_unpacked');
                    const isoUnpackDirArg = isoUnpackDir.endsWith(path.sep) ? isoUnpackDir : isoUnpackDir + path.sep;
                    const becUnpackDirArg = becUnpackDir.endsWith(path.sep) ? becUnpackDir : becUnpackDir + path.sep;
                    if (fs.existsSync(isoUnpackDir)) fs.rmSync(isoUnpackDir, { recursive: true, force: true });
                    if (fs.existsSync(becUnpackDir)) fs.rmSync(becUnpackDir, { recursive: true, force: true });
                    fs.mkdirSync(isoUnpackDir, { recursive: true });
                    fs.mkdirSync(becUnpackDir, { recursive: true });
                    this.logger.info(`Prepared unpack folders for ${modDisplayName}: ${isoUnpackDir} and ${becUnpackDir}.`);

                    const runScript = (label, scriptPath, scriptArgs, opts={}) => new Promise((resolve, reject) => {
                        this.logger.info(`${label} for ${modDisplayName}: ${path.basename(scriptPath)} ${scriptArgs.join(' ')}`);

                        const p = spawn(pythonCmd, [...pythonBaseArgs, scriptPath, ...scriptArgs], { cwd: toolsDir, ...opts });
                        let outBuf = '';
                        let errBuf = '';
                        p.stdout.on('data', d => outBuf += d.toString());
                        p.stderr.on('data', d => errBuf += d.toString());
                        p.on('error', e => {
                            this.logger.error(`Failed to start ${label} for ${modDisplayName}: ${e?.stack || e?.message || e}`);
                            reject(e);
                        });
                        p.on('close', c => {
                            const outSummary = String(outBuf || '').replace(/\s+/g, ' ').trim();
                            const errSummary = String(errBuf || '').replace(/\s+/g, ' ').trim();

                            if (c === 0) {
                                if (outSummary || errSummary) {
                                    this.logger.info(`${label} completed for ${modDisplayName}: ${(outSummary || errSummary).slice(0, 800)}`);
                                } else {
                                    this.logger.info(`${label} completed for ${modDisplayName}.`);
                                }
                                resolve();
                                return;
                            }

                            this.logger.error(`${label} failed for ${modDisplayName} with exit code ${c}: ${(errSummary || outSummary || 'no process output').slice(0, 800)}`);
                            reject(new Error(errSummary || ('exit code ' + c)));
                        });
                    });

                    const waitForFile = (p, timeoutMs=5000, intervalMs=200) => new Promise((resolve, reject) => {
                        const deadline = Date.now() + timeoutMs;
                        const poll = () => {
                            if (fs.existsSync(p)) {
                                return resolve();
                            }
                            if (Date.now() > deadline) {
                                const timeoutError = new Error('Timed out waiting for file: ' + p);
                                this.logger.error(`Timed out waiting for ${p} while updating ${modDisplayName}.`);
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
                                this.logger.error(`ISO unpack for ${modDisplayName} did not produce ${becFile}.`);
                                setStatus('gladius.bec not found after ISO unpack. Cannot proceed to BEC unpack.');
                                return Promise.reject(new Error('Missing gladius.bec'));
                            }
                            this.logger.info(`ISO unpack produced ${becFile} for ${modDisplayName}.`);
                            return setStatus('ISO unpack complete. Unpacking gladius.bec...')
                                .then(() => runScript('BEC unpack tool', becTool, ['-unpack', becFile, becUnpackDirArg]));
                        })
                        .then(() => {
                            const unpackedDataDir = path.join(becUnpackDir, 'data');
                            const unitsDir = path.join(unpackedDataDir, 'units');

                            if (!fs.existsSync(unitsDir)) {
                                this.logger.error(`BEC unpack for ${modDisplayName} did not produce units directory ${unitsDir}.`);
                                return Promise.reject(new Error(`Units directory not found after BEC unpack: ${unitsDir}`));
                            }

                            const missingUnitFilesBeforeIdx = requiredUnitFiles.filter(fileName => !fs.existsSync(path.join(unitsDir, fileName)));
                            this.logger.info(
                                `Running Units IDX unpack for ${modDisplayName} in ${unitsDir}` +
                                (missingUnitFilesBeforeIdx.length ? `; missing before unpack: ${missingUnitFilesBeforeIdx.join(', ')}` : '.')
                            );

                            return setStatus('BEC unpack complete. Unpacking units IDX data...')
                                .then(() => runScript('Units IDX unpack tool', unitsIdxTool, [unitsDir]))
                                .then(() => {
                                    const remainingMissingUnitFiles = requiredUnitFiles.filter(fileName => !fs.existsSync(path.join(unitsDir, fileName)));
                                    if (remainingMissingUnitFiles.length) {
                                        this.logger.error(`Units IDX unpack for ${modDisplayName} is still missing: ${remainingMissingUnitFiles.join(', ')}.`);
                                        return Promise.reject(new Error(`Units IDX unpack did not produce required files: ${remainingMissingUnitFiles.join(', ')}`));
                                    }

                                    this.logger.info(`Units IDX unpack produced required unit files for ${modDisplayName}.`);
                                });
                        })
                        .then(() => {
                            const unpackedDataDir = path.join(becUnpackDir, 'data');
                            if (!fs.existsSync(unpackedDataDir)) {
                                this.logger.error(`BEC unpack for ${modDisplayName} did not produce data directory ${unpackedDataDir}.`);
                                setStatus('BEC unpack finished but data folder not found.');
                                return;
                            }

                            // Keep bot-local data and central site data in sync.
                            const finalDataDir = path.join(modFolder, 'data');
                            if (fs.existsSync(finalDataDir)) fs.rmSync(finalDataDir, { recursive: true, force: true });
                            this.logger.info(`Moving unpacked data for ${modDisplayName} into ${finalDataDir}.`);
                            try {
                                fs.renameSync(unpackedDataDir, finalDataDir);
                                this.logger.info(`Moved unpacked data for ${modDisplayName} with rename.`);
                            } catch (e) {
                                this.logger.warn(`Rename failed for ${modDisplayName}; falling back to copy: ${e?.stack || e?.message || e}`);
                                try {
                                    fs.cpSync(unpackedDataDir, finalDataDir, { recursive: true });
                                    fs.rmSync(unpackedDataDir, { recursive: true, force: true });
                                    this.logger.info(`Copied unpacked data for ${modDisplayName} after rename failure.`);
                                } catch (copyErr) {
                                    this.logger.error(`Failed to copy unpacked data for ${modDisplayName}: ${copyErr?.stack || copyErr?.message || copyErr}`);
                                }
                            }

                            const centralModDir = path.join(gladiusDataRoot, sanitizedModDisplayName);
                            const centralDataDir = path.join(centralModDir, 'data');
                            let centralSyncError = null;
                            this.logger.info(`Syncing ${modDisplayName} data to ${centralDataDir}.`);
                            try {
                                fs.mkdirSync(centralModDir, { recursive: true });
                                if (fs.existsSync(centralDataDir)) {
                                    fs.rmSync(centralDataDir, { recursive: true, force: true });
                                }
                                fs.cpSync(finalDataDir, centralDataDir, { recursive: true });
                                this.logger.info(`Synced ${modDisplayName} data to ${centralDataDir}.`);
                            } catch (syncErr) {
                                centralSyncError = syncErr;
                                this.logger.error(`Failed to sync ${modDisplayName} data to ${centralDataDir}: ${syncErr?.stack || syncErr?.message || syncErr}`);
                            }

                            try {
                                const removedEntries = [];
                                for (const entry of fs.readdirSync(modFolder)) {
                                    if (entry !== 'data') {
                                        fs.rmSync(path.join(modFolder, entry), { recursive: true, force: true });
                                        removedEntries.push(entry);
                                    }
                                }
                                if (removedEntries.length) {
                                    this.logger.info(`Cleaned temporary artifacts for ${modDisplayName}: ${removedEntries.join(', ')}.`);
                                }
                            } catch (cleanErr) {
                                this.logger.error(`Failed to clean temporary artifacts for ${modDisplayName}: ${cleanErr?.stack || cleanErr?.message || cleanErr}`);
                            }

                            if (centralSyncError) {
                                this.logger.warn(`Completed local update for ${modDisplayName}, but sync to ${centralModDir} failed.`);
                                setStatus(`Backend updated locally, but failed to sync to ${centralModDir}: ${centralSyncError.message}`);
                            } else {
                                this.logger.info(`Completed mod update for ${modDisplayName}; synced data to ${centralModDir}.`);
                                setStatus(`Backend updated and synced to ${centralModDir}`);
                            }
                        })
                        .catch(err => {
                            this.logger.error(`Unpack pipeline failed for ${modDisplayName}: ${err?.stack || err?.message || err}`);
                            setStatus('An error occurred during unpack: ' + err.message);
                        });
                } else {
                    this.logger.error(
                        `xdelta3 failed for ${modDisplayName} with exit code ${code}; outputIsoExists=${outputIsoExists}: ` +
                        `${(stderrSummary || stdoutSummary || 'no process output').slice(0, 800)}`
                    );
                    this.logger.error('xdelta3 failed', stderr || ('exit code ' + code));
                    setStatus('Patch application failed. Check that the patch matches vanilla.iso.');
                }
            });
        } catch (err) {
            this.logger.error(`Error updating ${activeModName || requestedModName || 'unknown mod'}: ${err?.stack || err?.message || err}`);
            await setStatus('An error occurred while processing the patch.');
        }
    }
};