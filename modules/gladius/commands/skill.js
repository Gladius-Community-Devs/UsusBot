const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    name: 'skill',
    description: 'Finds and displays information for a specified skill.',
    syntax: 'skill [mod (optional)] [class (optional)] [skill name]',
    num_args: 1,
    args_to_lower: true,
    needs_api: false,
    has_state: false,
    async execute(message, args, extra) {
        // Adjusted sanitizeInput to allow apostrophes and hyphens
        const sanitizeInput = (input) => {
            return input.replace(/[^\w\s'’-]/g, '').trim();
        };

        if (args.length <= 1) {
            message.channel.send({ content: 'Please provide the skill name.' });
            return;
        }

        const moddersConfigPath = path.join(__dirname, '../modders.json');
        let modName = 'Vanilla';
        let index = 1; // Start after the command name

        try {
            // Load modders.json
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));

            // Sanitize modNameInput
            let modNameInput = sanitizeInput(args[1]);

            // Check if args[1] is a valid mod name
            let isMod = false;
            for (const modder in moddersConfig) {
                const modConfigName = moddersConfig[modder].replace(/\s+/g, '_').toLowerCase();
                if (modConfigName === modNameInput.replace(/\s+/g, '_').toLowerCase()) {
                    isMod = true;
                    modName = moddersConfig[modder].replace(/\s+/g, '_');
                    index = 2; // Move index to next argument
                    break;
                }
            }

            // Sanitize modName
            modName = path.basename(sanitizeInput(modName));

            // Define file paths securely
            const baseUploadsPath = path.join(__dirname, '../../../uploads');
            const modPath = path.join(baseUploadsPath, modName);
            const lookupFilePath = path.join(modPath, 'data', 'config', 'lookuptext_eng.txt');
            const skillsFilePath = path.join(modPath, 'data', 'config', 'skills.tok');

            // Check if files exist
            if (!fs.existsSync(lookupFilePath)) {
                message.channel.send({ content: `That mod does not have files yet!` });
                return;
            }

            if (!fs.existsSync(skillsFilePath)) {
                message.channel.send({ content: `That mod is missing its skills.tok file!` });
                return;
            }

            // Collect all possible skill names and map them to entry IDs
            const lookupContent = fs.readFileSync(lookupFilePath, 'utf8');
            const lookupLines = lookupContent.split(/\r?\n/);

            // Build a map of skill names to entry IDs
            const skillNameToEntryIds = {};
            for (const line of lookupLines) {
                if (!line.trim()) continue;
                const fields = line.split('^');
                const id = parseInt(fields[0].trim());
                const name = fields[fields.length - 1].trim().toLowerCase();
                if (!skillNameToEntryIds[name]) {
                    skillNameToEntryIds[name] = [];
                }
                skillNameToEntryIds[name].push(id);
            }

            // Read the skills.tok file
            const skillsContent = fs.readFileSync(skillsFilePath, 'utf8');
            const skillsChunks = skillsContent.split(/\n\s*\n/);

            // Function to parse a skill chunk into a key-value object
            const parseSkillChunk = (chunk) => {
                const lines = chunk.trim().split(/\r?\n/);
                const skillData = {};
                for (const line of lines) {
                    const lineTrimmed = line.trim();
                    const match = lineTrimmed.match(/^(\w+):\s*(.+)$/);
                    if (match) {
                        const key = match[1].toUpperCase();
                        let value = match[2].trim();

                        // Remove surrounding quotes if present
                        if (value.startsWith('"') && value.endsWith('"')) {
                            value = value.substring(1, value.length - 1);
                        }

                        // Store all values as arrays
                        if (!skillData[key]) {
                            skillData[key] = [];
                        }
                        skillData[key].push(value);
                    }
                }
                return skillData;
            };

            // Function to collect all skills in a combo chain
            const collectComboChain = (initialSkillData, skillsChunks) => {
                const comboSkills = [];
                let currentSkill = initialSkillData;
                
                // First, check if this is a combo skill (has SKILLMETER with "Chain")
                if (currentSkill['SKILLMETER'] && currentSkill['SKILLMETER'][0].includes('Chain')) {
                    comboSkills.push({ 
                        skillData: currentSkill, 
                        isInitial: true,
                        chunk: findOriginalChunk(currentSkill, skillsChunks)
                    });
                    
                    // Determine the maximum additional hits from the initial SKILLMETER
                    let meterParts = currentSkill['SKILLMETER'][0].split(',').map(s => s.trim().replace(/"/g, ''));
                    const maxAdditionalHits = meterParts.length >= 3 ? parseInt(meterParts[2], 10) - 1 : 0;
                    
                    // Follow the chain of subskills
                    let hitNumber = 1;
                    while (hitNumber <= maxAdditionalHits && currentSkill['SKILLSUBSKILL']) {
                        const subSkillName = currentSkill['SKILLSUBSKILL'][0];
                        let foundSubSkill = null;
                        let foundChunk = null;
                        
                        // Find the subskill in the chunks
                        for (const chunk of skillsChunks) {
                            if (chunk.includes('SKILLCREATE:')) {
                                const subSkillData = parseSkillChunk(chunk);
                                if (subSkillData['SKILLCREATE'] && 
                                    subSkillData['SKILLCREATE'][0].includes(subSkillName)) {
                                    foundSubSkill = subSkillData;
                                    foundChunk = chunk;
                                    break;
                                }
                            }
                        }
                        
                        if (!foundSubSkill) break;
                        
                        // Add the subskill to our chain
                        comboSkills.push({ 
                            skillData: foundSubSkill, 
                            hitNumber: hitNumber + 1,
                            chunk: foundChunk
                        });
                        
                        currentSkill = foundSubSkill;
                        hitNumber++;
                    }
                }
                return comboSkills;
            };
            
            // Helper function to find the original chunk for a skill
            const findOriginalChunk = (skillData, skillsChunks) => {
                if (!skillData['SKILLCREATE']) return '';
                
                const skillName = skillData['SKILLCREATE'][0];
                for (const chunk of skillsChunks) {
                    if (chunk.includes('SKILLCREATE:') && chunk.includes(skillName)) {
                        return chunk;
                    }
                }
                return '';
            };

            // Initialize variables
            let className = '';
            let skillName = '';
            let foundMatchingSkills = false;
            let matchingSkills = [];

            // Try all possible splits between class name and skill name
            for (let splitIndex = index; splitIndex <= args.length; splitIndex++) {
                let potentialClassName = args.slice(index, splitIndex).join(' ').trim();
                let potentialSkillName = args.slice(splitIndex, args.length).join(' ').trim();

                if (!potentialSkillName) continue; // Skill name is required

                // Sanitize inputs
                potentialClassName = sanitizeInput(potentialClassName);
                potentialSkillName = sanitizeInput(potentialSkillName);

                skillName = potentialSkillName;

                // Get all entry IDs for the potential skill name
                const entryIds = skillNameToEntryIds[potentialSkillName.toLowerCase()] || [];

                if (entryIds.length === 0) {
                    continue; // No skill with this name, try next split
                }

                // For each skill chunk, collect matching skills
                matchingSkills = [];
                for (const chunk of skillsChunks) {
                    if (chunk.includes('SKILLCREATE:')) {
                        const skillData = parseSkillChunk(chunk);
                        if (skillData['SKILLDISPLAYNAMEID'] && entryIds.includes(parseInt(skillData['SKILLDISPLAYNAMEID'][0]))) {
                            let skillClasses = skillData['SKILLUSECLASS'] || ['Unknown'];
                            if (!Array.isArray(skillClasses)) {
                                skillClasses = [skillClasses];
                            }
                            // Check if the skill matches the potential class name (if provided)
                            if (potentialClassName) {
                                if (skillClasses.some(cls => cls.toLowerCase() === potentialClassName.toLowerCase())) {
                                    matchingSkills.push({
                                        entryId: parseInt(skillData['SKILLDISPLAYNAMEID'][0]),
                                        chunk: chunk.trim(),
                                        classNames: skillClasses,
                                        skillData: skillData // Include skillData for later use
                                    });
                                }
                            } else {
                                // No class name specified, collect all matching skills
                                matchingSkills.push({
                                    entryId: parseInt(skillData['SKILLDISPLAYNAMEID'][0]),
                                    chunk: chunk.trim(),
                                    classNames: skillClasses,
                                    skillData: skillData // Include skillData for later use
                                });
                            }
                        }
                    }
                }

                if (matchingSkills.length > 0) {
                    className = potentialClassName;
                    foundMatchingSkills = true;

                    // Now, get the target SKILLDISPLAYNAMEID and SKILLUSECLASS of the first matching skill
                    const targetSKILLDISPLAYNAMEID = matchingSkills[0].entryId;
                    const targetSKILLUSECLASS = matchingSkills[0].classNames[0];

                    // Now collect all skill chunks that have this SKILLDISPLAYNAMEID and SKILLUSECLASS
                    let allMatchingSkills = [];
                    for (const chunk of skillsChunks) {
                        if (chunk.includes('SKILLCREATE:')) {
                            const skillData = parseSkillChunk(chunk);
                            if (skillData['SKILLDISPLAYNAMEID'] && parseInt(skillData['SKILLDISPLAYNAMEID'][0]) === targetSKILLDISPLAYNAMEID) {
                                let skillClasses = skillData['SKILLUSECLASS'] || ['Unknown'];
                                if (!Array.isArray(skillClasses)) {
                                    skillClasses = [skillClasses];
                                }
                                if (skillClasses.some(cls => cls.toLowerCase() === targetSKILLUSECLASS.toLowerCase())) {
                                    allMatchingSkills.push({
                                        entryId: targetSKILLDISPLAYNAMEID,
                                        chunk: chunk.trim(),
                                        classNames: skillClasses,
                                        skillData: skillData // Include skillData for later use
                                    });
                                }
                            }
                        }
                    }

                    matchingSkills = allMatchingSkills;

                    break; // Exit the loop as we've found matching skills
                }
            }

            if (!foundMatchingSkills) {
                message.channel.send({ content: `No skill named '${args.slice(index).join(' ')}' found in '${modName}'.` });
                return;
            }

            // Collect all classes that have the skill name, regardless of SKILLDISPLAYNAMEID
            let allClassesWithSkillName = new Set();

            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = parseSkillChunk(chunk);
                    if (skillData['SKILLDISPLAYNAMEID']) {
                        const entryId = parseInt(skillData['SKILLDISPLAYNAMEID'][0]);
                        const skillEntryIds = skillNameToEntryIds[skillName.toLowerCase()] || [];
                        if (skillEntryIds.includes(entryId)) {
                            let skillClasses = skillData['SKILLUSECLASS'] || ['Unknown'];
                            if (!Array.isArray(skillClasses)) {
                                skillClasses = [skillClasses];
                            }
                            for (const cls of skillClasses) {
                                allClassesWithSkillName.add(cls.toLowerCase());
                            }
                        }
                    }
                }
            }

            // Collect classNames from matchingSkills
            const matchingSkillClassNames = matchingSkills.flatMap(skill => skill.classNames.map(cls => cls.toLowerCase()));

            // Prepare 'otherClasses' by excluding classes already in matchingSkills
            const otherClasses = [...allClassesWithSkillName].filter(cls => !matchingSkillClassNames.includes(cls) && cls !== 'unknown');

            // Combine all classes into one array
            const allClasses = [...new Set([...matchingSkillClassNames, ...otherClasses])];

            // URL encode the modName and skillName to safely include them in customId
            const encodedModName = encodeURIComponent(modName);
            const encodedSkillName = encodeURIComponent(skillName);

            // Create options for the select menus
            const classOptions = allClasses.map(cls => ({
                label: cls.charAt(0).toUpperCase() + cls.slice(1),
                value: encodeURIComponent(cls.toLowerCase())
            }));

            // Create select menus, splitting options into groups of 25 if necessary
            const rows = [];
            for (let i = 0; i < classOptions.length; i += 25) {
                const optionsChunk = classOptions.slice(i, i + 25);
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`class-select|${encodedModName}|${encodedSkillName}|${i}`)
                    .setPlaceholder('Select a class')
                    .addOptions(optionsChunk);
                const row = new ActionRowBuilder().addComponents(selectMenu);
                rows.push(row);
            }

            // Prepare the response
            let messages = [];
            let header = `Skill details for '${skillName}' in '${modName}'${className ? ` for class '${className}'` : ''}:

`;
            let currentMessage = header;

            // Check for combo skills and include all chain parts in output
            for (const skill of matchingSkills) {
                // Get the skill data
                const skillData = skill.skillData;
                
                // Check if this is a combo skill
                const comboSkills = collectComboChain(skillData, skillsChunks);
                
                if (comboSkills.length > 1) { // Only treat as combo if there's more than one skill
                    // This is a combo skill, add header for combo chain
                    const comboHeader = `\n==== Combo Chain (${comboSkills.length} hits) ====\n\n`;
                    if (currentMessage.length + comboHeader.length > 2000) {
                        messages.push(currentMessage);
                        currentMessage = comboHeader;
                    } else {
                        currentMessage += comboHeader;
                    }
                    
                    // Add each skill in the combo chain
                    for (const comboSkill of comboSkills) {
                        const hitText = comboSkill.isInitial ? 'Initial Hit' : `Hit #${comboSkill.hitNumber}`;
                        const skillText = `=== ${hitText} ===\n\`\`\`\n${comboSkill.chunk.trim()}\n\`\`\`\n\n`;
                        
                        if (currentMessage.length + skillText.length > 2000) {
                            messages.push(currentMessage);
                            currentMessage = skillText;
                        } else {
                            currentMessage += skillText;
                        }
                    }
                } else {
                    // Regular non-combo skill
                    const skillText = `\`\`\`\n${skill.chunk}\n\`\`\`\n\n`;
                    if (currentMessage.length + skillText.length > 2000) {
                        messages.push(currentMessage);
                        currentMessage = skillText;
                    } else {
                        currentMessage += skillText;
                    }
                }
            }

            if (currentMessage.length > 0) {
                messages.push(currentMessage);
            }

            // Send the messages
            for (const [index, msg] of messages.entries()) {
                if (index === messages.length - 1) {
                    // Create a "View Learnable Skills" button for the class
                    if (className) {
                        const learnableButton = new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`learnable-skills|${modName}|${className}`)
                                    .setLabel(`View All ${className} Skills`)
                                    .setStyle(ButtonStyle.Success)
                            );
                        
                        // Add the button along with the class select dropdown
                        await message.channel.send({ content: msg, components: [...rows, learnableButton] });
                    } else {
                        await message.channel.send({ content: msg, components: rows });
                    }
                } else {
                    await message.channel.send({ content: msg });
                }
            }

            // Send the message with the select menus
            // await message.channel.send({ content: 'Please select a class:', components: rows });
        } catch (error) {
            this.logger.error('Error finding the skill:', error);
            message.channel.send({ content: 'An error occurred while finding the skill.' });
        }
    }
};
