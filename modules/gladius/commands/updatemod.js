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

        // Defer immediately — processing can take a long time
        await interaction.deferReply();

        // Helper: update the deferred reply with a status message
        const setStatus = async (text) => {
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
        if (overrideRequested && !hasAdminRole) {
            await setStatus('The override flag is only available to users with the Admin role.');
            return;
        }

        const useOverride = hasAdminRole && overrideRequested;
        if (!hasModderRole && !useOverride) {
            await setStatus('You do not have permission to use this command. (Modder role required, or Admin with override enabled)');
            return;
        }

        // 2. Validate attachment
        const attachment = interaction.options.getAttachment('patch');
        if (!attachment.name.toLowerCase().endsWith('.xdelta') && !attachment.name.toLowerCase().endsWith('.xdelta3')) {
            await setStatus('Attached file must end with .xdelta or .xdelta3.');
            return;
        }

        try {
            // 3. Determine target mod name for user from shared modders file
            const moddersFilePath = getModdersFilePath();
            const config = readModders();
            const requestedModName = interaction.options.getString('mod_name');
            let modDisplayName = null;

            if (useOverride) {
                if (!requestedModName) {
                    await setStatus('Admin override requires mod_name. Re-run the command and select the mod to update.');
                    return;
                }

                const allMods = getAllModNames(config);
                modDisplayName = allMods.find(mod => mod.toLowerCase() === requestedModName.toLowerCase()) || null;
                if (!modDisplayName) {
                    await setStatus(`Mod '${requestedModName}' was not found in the shared modders list (${moddersFilePath}).`);
                    return;
                }
            } else {
                const modderId = interaction.user.id;
                const ownedMods = getModNamesForDiscordId(config, modderId);
                if (!ownedMods.length) {
                    await setStatus(`You are not listed in the shared modders list (${moddersFilePath}). Ask an admin to register your mod.`);
                    return;
                }

                if (requestedModName) {
                    modDisplayName = ownedMods.find(mod => mod.toLowerCase() === requestedModName.toLowerCase()) || null;
                    if (!modDisplayName) {
                        await setStatus(`You do not own mod '${requestedModName}'. Owned mods: ${ownedMods.join(', ')}`);
                        return;
                    }
                } else if (ownedMods.length === 1) {
                    modDisplayName = ownedMods[0];
                } else {
                    await setStatus(`You own multiple mods. Re-run with mod_name set to one of: ${ownedMods.join(', ')}`);
                    return;
                }
            }

            this.logger.info(`Starting mod update for ${modDisplayName} requested by ${interaction.user.id}${useOverride ? ' with admin override' : ''}.`);
            const sanitizedModDisplayName = modDisplayName.replace(/\s+/g, '_');

            // Paths
            const uploadsRoot = path.join(__dirname, '../../../uploads');
            const gladiusDataRoot = process.env.GLADIUS_DATA_ROOT || process.env.GLADIUS_GAME_DATA_PATH;
            if (!gladiusDataRoot || !gladiusDataRoot.trim()) {
                await setStatus('GLADIUS_DATA_ROOT is not set in the bot environment.');
                return;
            }
            const vanillaIsoPath = path.join(uploadsRoot, 'vanilla.iso');
            if (!fs.existsSync(vanillaIsoPath)) {
                await setStatus('vanilla.iso not found in uploads folder. Notify an admin.');
                return;
            }
            const modFolder = path.join(uploadsRoot, sanitizedModDisplayName);
            if (!fs.existsSync(modFolder)) fs.mkdirSync(modFolder, { recursive: true });

            // File destinations
            const patchFilePath = path.join(modFolder, 'patch.xdelta');
            const workingVanillaPath = path.join(modFolder, 'vanilla.iso');
            const outputIsoPath = path.join(modFolder, sanitizedModDisplayName + '_modded.iso');

            // Clean previous artifacts
            if (fs.existsSync(patchFilePath)) fs.unlinkSync(patchFilePath);
            if (fs.existsSync(workingVanillaPath)) fs.unlinkSync(workingVanillaPath);
            if (fs.existsSync(outputIsoPath)) fs.unlinkSync(outputIsoPath);

            await setStatus('Downloading patch and preparing to apply...');

            // Download patch attachment
            const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
            fs.writeFileSync(patchFilePath, Buffer.from(response.data));

            // Copy vanilla.iso
            fs.copyFileSync(vanillaIsoPath, workingVanillaPath);

            const xdeltaExe = 'xdelta3';
            // Command: xdelta3 -d -s source patch output
            const argsList = ['-d', '-s', workingVanillaPath, patchFilePath, outputIsoPath];
            const proc = spawn(xdeltaExe, argsList, { windowsHide: true });
            let stderr = '';
            proc.stderr.on('data', d => { stderr += d.toString(); });
            proc.on('error', error => {
                this.logger.error('Failed to start xdelta3 process:', error);
                setStatus('Failed to start xdelta3. Is it installed on the server?');
            });
            proc.on('close', code => {
                if (code === 0 && fs.existsSync(outputIsoPath)) {
                    // Begin unpack step (requires Python and scripts in uploads/tools)
                    const toolsDir = path.join(uploadsRoot, 'tools');
                    const isoTool = path.join(toolsDir, 'ngciso-tool-gc.py');
                    const becTool = path.join(toolsDir, 'bec-tool-all.py');
                    const fileList = path.join(toolsDir, `${sanitizedModDisplayName}_FileList.txt`);
                    if (!fs.existsSync(toolsDir) || !fs.existsSync(isoTool) || !fs.existsSync(becTool)) {
                        setStatus('Tools or required scripts missing. Skipping unpack.');
                        return;
                    }

                    const isoUnpackDir = path.join(modFolder, 'iso_unpacked');
                    const becUnpackDir = path.join(modFolder, 'bec_unpacked');
                    const isoUnpackDirArg = isoUnpackDir.endsWith(path.sep) ? isoUnpackDir : isoUnpackDir + path.sep;
                    const becUnpackDirArg = becUnpackDir.endsWith(path.sep) ? becUnpackDir : becUnpackDir + path.sep;
                    if (fs.existsSync(isoUnpackDir)) fs.rmSync(isoUnpackDir, { recursive: true, force: true });
                    if (fs.existsSync(becUnpackDir)) fs.rmSync(becUnpackDir, { recursive: true, force: true });
                    fs.mkdirSync(isoUnpackDir, { recursive: true });
                    fs.mkdirSync(becUnpackDir, { recursive: true });

                    const runScript = (scriptPath, scriptArgs, opts={}) => new Promise((resolve, reject) => {
                        const p = spawn(pythonCmd, [...pythonBaseArgs, scriptPath, ...scriptArgs], { cwd: toolsDir, ...opts });
                        let errBuf = '';
                        p.stderr.on('data', d => errBuf += d.toString());
                        p.on('error', e => reject(e));
                        p.on('close', c => c === 0 ? resolve() : reject(new Error(errBuf || ('exit code ' + c))));
                    });

                    const waitForFile = (p, timeoutMs=5000, intervalMs=200) => new Promise((resolve, reject) => {
                        const deadline = Date.now() + timeoutMs;
                        const poll = () => {
                            if (fs.existsSync(p)) return resolve();
                            if (Date.now() > deadline) return reject(new Error('Timed out waiting for file: ' + p));
                            setTimeout(poll, intervalMs);
                        };
                        poll();
                    });

                    waitForFile(outputIsoPath)
                        .then(() => setStatus('Unpacking patched ISO...'))
                        .then(() => runScript(isoTool, ['-unpack', outputIsoPath, isoUnpackDirArg, fileList]))
                        .then(() => {
                            const becFile = path.join(isoUnpackDir, 'gladius.bec');
                            if (!fs.existsSync(becFile)) {
                                setStatus('gladius.bec not found after ISO unpack. Cannot proceed to BEC unpack.');
                                return Promise.reject(new Error('Missing gladius.bec'));
                            }
                            return setStatus('ISO unpack complete. Unpacking gladius.bec...')
                                .then(() => runScript(becTool, ['-unpack', becFile, becUnpackDirArg]));
                        })
                        .then(() => {
                            const unpackedDataDir = path.join(becUnpackDir, 'data');
                            if (!fs.existsSync(unpackedDataDir)) {
                                setStatus('BEC unpack finished but data folder not found.');
                                return;
                            }

                            // Keep bot-local data and central site data in sync.
                            const finalDataDir = path.join(modFolder, 'data');
                            if (fs.existsSync(finalDataDir)) fs.rmSync(finalDataDir, { recursive: true, force: true });
                            try {
                                fs.renameSync(unpackedDataDir, finalDataDir);
                            } catch (e) {
                                try {
                                    fs.cpSync(unpackedDataDir, finalDataDir, { recursive: true });
                                    fs.rmSync(unpackedDataDir, { recursive: true, force: true });
                                } catch (copyErr) {
                                    this.logger.error('Data move error:', copyErr);
                                }
                            }

                            const centralModDir = path.join(gladiusDataRoot, sanitizedModDisplayName);
                            const centralDataDir = path.join(centralModDir, 'data');
                            let centralSyncError = null;
                            try {
                                fs.mkdirSync(centralModDir, { recursive: true });
                                if (fs.existsSync(centralDataDir)) {
                                    fs.rmSync(centralDataDir, { recursive: true, force: true });
                                }
                                fs.cpSync(finalDataDir, centralDataDir, { recursive: true });
                            } catch (syncErr) {
                                centralSyncError = syncErr;
                                this.logger.error('Central data sync error:', syncErr);
                            }

                            try {
                                for (const entry of fs.readdirSync(modFolder)) {
                                    if (entry !== 'data') fs.rmSync(path.join(modFolder, entry), { recursive: true, force: true });
                                }
                            } catch (cleanErr) {
                                this.logger.error('Cleanup error:', cleanErr);
                            }

                            if (centralSyncError) {
                                setStatus(`Backend updated locally, but failed to sync to ${centralModDir}: ${centralSyncError.message}`);
                            } else {
                                this.logger.info(`Completed mod update for ${modDisplayName}; synced data to ${centralModDir}.`);
                                setStatus(`Backend updated and synced to ${centralModDir}`);
                            }
                        })
                        .catch(err => {
                            this.logger.error('Unpack error:', err);
                            setStatus('An error occurred during unpack: ' + err.message);
                        });
                } else {
                    this.logger.error('xdelta3 failed', stderr || ('exit code ' + code));
                    setStatus('Patch application failed. Check that the patch matches vanilla.iso.');
                }
            });
        } catch (err) {
            this.logger.error('Error updating mod:', err);
            await setStatus('An error occurred while processing the patch.');
        }
    }
};