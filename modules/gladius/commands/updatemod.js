const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('updatemod')
        .setDescription('(MODDER ONLY) Apply an xdelta patch to vanilla.iso and unpack your mod files')
        .addAttachmentOption(option =>
            option.setName('patch')
                .setDescription('The .xdelta or .xdelta3 patch file to apply')
                .setRequired(true)),
    name: 'updatemod',
    has_state: false,
    needs_api: false,
    async execute(interaction, extra) {
        const fs = require('fs');
        const path = require('path');
        const axios = require('axios');
        const { spawn } = require('child_process');

        // Defer immediately — processing can take a long time
        await interaction.deferReply();

        // Helper: update the deferred reply with a status message
        const setStatus = async (text) => {
            try { await interaction.editReply({ content: text }); } catch (_) {}
        };

        // Python launcher detection (Windows uses py -3, others use python3)
        const isWin = process.platform === 'win32';
        const pythonCmd = isWin ? 'py' : 'python3';
        const pythonBaseArgs = isWin ? ['-3'] : [];

        // 1. Check role
        if (!interaction.member.roles.cache.some(role => role.name === 'Modder')) {
            await setStatus('You do not have permission to use this command. (Modder role required)');
            return;
        }

        // 2. Validate attachment
        const attachment = interaction.options.getAttachment('patch');
        if (!attachment.name.toLowerCase().endsWith('.xdelta') && !attachment.name.toLowerCase().endsWith('.xdelta3')) {
            await setStatus('Attached file must end with .xdelta or .xdelta3.');
            return;
        }

        try {
            // 3. Determine mod name for user from modders.json
            const configPath = path.join(__dirname, '../modders.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const modderId = interaction.user.id;
            const modDisplayName = config[modderId];
            if (!modDisplayName) {
                await setStatus('You are not listed in modders.json. Ask an admin to register your mod.');
                return;
            }
            const sanitizedModDisplayName = modDisplayName.replace(/\s+/g, '_');

            // Paths
            const uploadsRoot = path.join(__dirname, '../../../uploads');
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
            proc.on('error', () => {
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
                            const finalDataDir = path.join(modFolder, 'data');
                            if (fs.existsSync(finalDataDir)) fs.rmSync(finalDataDir, { recursive: true, force: true });
                            try {
                                fs.renameSync(unpackedDataDir, finalDataDir);
                            } catch (e) {
                                try {
                                    fs.cpSync(unpackedDataDir, finalDataDir, { recursive: true });
                                    fs.rmSync(unpackedDataDir, { recursive: true, force: true });
                                } catch (copyErr) {
                                    extra && extra.logger && extra.logger.error('Data move error:', copyErr);
                                }
                            }
                            try {
                                for (const entry of fs.readdirSync(modFolder)) {
                                    if (entry !== 'data') fs.rmSync(path.join(modFolder, entry), { recursive: true, force: true });
                                }
                            } catch (cleanErr) {
                                extra && extra.logger && extra.logger.error('Cleanup error:', cleanErr);
                            }
                            setStatus('Backend updated!');
                        })
                        .catch(err => {
                            extra && extra.logger && extra.logger.error('Unpack error:', err);
                            setStatus('An error occurred during unpack: ' + err.message);
                        });
                } else {
                    extra && extra.logger && extra.logger.error('xdelta3 failed', stderr || ('exit code ' + code));
                    setStatus('Patch application failed. Check that the patch matches vanilla.iso.');
                }
            });
        } catch (err) {
            extra && extra.logger && extra.logger.error('Error updating mod:', err);
            await setStatus('An error occurred while processing the patch.');
        }
    }
};