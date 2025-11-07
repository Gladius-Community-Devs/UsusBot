module.exports = {
    name: 'updatemod',
    description: '(MODDER ONLY) Applies an uploaded xdelta patch to vanilla.iso for this modder and produces a patched ISO in their folder',
    syntax: 'updatemod',
    num_args: 0,
    args_to_lower: false,
    needs_api: false,
    has_state: false,
    async execute(message, args) {
        const fs = require('fs');
        const path = require('path');
        const axios = require('axios');
        const { spawn } = require('child_process');

        // 1. Check role
        if (!message.member.roles.cache.some(role => role.name === 'Modder')) {
            message.channel.send({ content: 'You do not have permission to use this command. (Modder role required)' });
            return;
        }

        // 3. Check attachment present
        if (message.attachments.size === 0) {
            message.channel.send({ content: 'Please attach an .xdelta patch file.' });
            return;
        }

        const attachment = message.attachments.first();
        if (!attachment.name.toLowerCase().endsWith('.xdelta') && !attachment.name.toLowerCase().endsWith('.xdelta3')) {
            message.channel.send({ content: 'Attached file must end with .xdelta or .xdelta3.' });
            return;
        }

        try {
            // 2. Determine mod name for user from modders.json
            const configPath = path.join(__dirname, '../modders.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const modderId = message.author.id;
            const modDisplayName = config[modderId];
            if (!modDisplayName) {
                message.channel.send({ content: 'You are not listed in modders.json. Ask an admin to register your mod.' });
                return;
            }
            const sanitizedModDisplayName = modDisplayName.replace(/\s+/g, '_');

            // Paths
            const uploadsRoot = path.join(__dirname, '../../../uploads');
            const vanillaIsoPath = path.join(uploadsRoot, 'vanilla.iso');
            if (!fs.existsSync(vanillaIsoPath)) {
                message.channel.send({ content: 'vanilla.iso not found in uploads folder. Notify an admin.' });
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

            message.channel.send({ content: 'Downloading patch and preparing to apply...' });

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
            proc.on('error', err => {
                message.channel.send({ content: 'Failed to start xdelta3. Is it installed on the server?'});
            });
            proc.on('close', code => {
                if (code === 0 && fs.existsSync(outputIsoPath)) {
                    message.channel.send({ content: `Patch applied successfully. Output ISO: ${sanitizedModDisplayName}_modded.iso` });

                    // Begin unpack step (Linux-compatible; requires python3 and scripts in uploads/tools)
                    const toolsDir = path.join(uploadsRoot, 'tools');
                    const isoTool = path.join(toolsDir, 'ngciso-tool-gc.py');
                    const becTool = path.join(toolsDir, 'bec-tool-all.py');
                    const fileList = path.join(toolsDir, `${sanitizedModDisplayName}_FileList.txt`);
                    if (!fs.existsSync(toolsDir) || !fs.existsSync(isoTool) || !fs.existsSync(becTool)) {
                        message.channel.send({ content: 'Tools or required scripts missing. Skipping unpack.' });
                        return;
                    }

                    // Use separate subdirectories so we do NOT delete the mod folder (which contains the freshly created ISO)
                    const isoUnpackDir = path.join(modFolder, 'iso_unpacked');
                    const becUnpackDir = path.join(modFolder, 'bec_unpacked');
                    // Ensure trailing separators for tools that may naively concat child paths
                    const isoUnpackDirArg = isoUnpackDir.endsWith(path.sep) ? isoUnpackDir : isoUnpackDir + path.sep;
                    const becUnpackDirArg = becUnpackDir.endsWith(path.sep) ? becUnpackDir : becUnpackDir + path.sep;
                    // Clean / create sub dirs only
                    if (fs.existsSync(isoUnpackDir)) fs.rmSync(isoUnpackDir, { recursive: true, force: true });
                    if (fs.existsSync(becUnpackDir)) fs.rmSync(becUnpackDir, { recursive: true, force: true });
                    fs.mkdirSync(isoUnpackDir, { recursive: true });
                    fs.mkdirSync(becUnpackDir, { recursive: true });

                    const runScript = (scriptPath, scriptArgs, opts={}) => new Promise((resolve, reject) => {
                        const p = spawn('python3', [scriptPath, ...scriptArgs], { cwd: toolsDir, ...opts });
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
                        .then(() => {
                            message.channel.send({ content: 'Unpacking patched ISO...' });
                            return runScript(isoTool, ['-unpack', outputIsoPath, isoUnpackDirArg, fileList]);
                        })
                        .then(() => {
                            const becFile = path.join(isoUnpackDir, 'gladius.bec');
                            if (!fs.existsSync(becFile)) {
                                message.channel.send({ content: 'gladius.bec not found after ISO unpack. Cannot proceed to BEC unpack.' });
                                return Promise.reject(new Error('Missing gladius.bec'));
                            }
                            message.channel.send({ content: 'ISO unpack complete. Unpacking gladius.bec...' });
                            return runScript(becTool, ['-unpack', becFile, becUnpackDirArg]);
                        })
                        .then(() => {
                            // Move bec_unpacked/data to modFolder/data and delete everything else
                            const unpackedDataDir = path.join(becUnpackDir, 'data');
                            if (!fs.existsSync(unpackedDataDir)) {
                                message.channel.send({ content: 'BEC unpack finished but data folder not found.' });
                                return;
                            }
                            const finalDataDir = path.join(modFolder, 'data');
                            if (fs.existsSync(finalDataDir)) fs.rmSync(finalDataDir, { recursive: true, force: true });
                            try {
                                fs.renameSync(unpackedDataDir, finalDataDir);
                            } catch (e) {
                                try { fs.cpSync(unpackedDataDir, finalDataDir, { recursive: true }); fs.rmSync(unpackedDataDir, { recursive: true, force: true }); } catch (copyErr) { this.logger && this.logger.error('Data move error:', copyErr); }
                            }
                            try {
                                for (const entry of fs.readdirSync(modFolder)) {
                                    if (entry !== 'data') fs.rmSync(path.join(modFolder, entry), { recursive: true, force: true });
                                }
                            } catch (cleanErr) {
                                this.logger && this.logger.error('Cleanup error:', cleanErr);
                            }
                            message.channel.send({ content: 'BEC unpack complete. Data isolated. Mod update process finished.' });
                        })
                        .catch(err => {
                            this.logger && this.logger.error('Unpack error:', err);
                            message.channel.send({ content: 'An error occurred during unpack: ' + err.message });
                        });
                } else {
                    this.logger && this.logger.error('xdelta3 failed', stderr || ('exit code ' + code));
                    message.channel.send({ content: 'Patch application failed. Check that the patch matches vanilla.iso.' });
                }
            });
        } catch (err) {
            this.logger && this.logger.error('Error updating mod:', err);
            message.channel.send({ content: 'An error occurred while processing the patch.' });
        }
    }
};