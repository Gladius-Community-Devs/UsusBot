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