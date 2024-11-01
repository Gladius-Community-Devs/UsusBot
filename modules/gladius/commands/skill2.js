module.exports = {
    name: 'skill2',
    description: 'Gives a natural language description of a skill.',
    syntax: 'skill2 [mod (o)] [class (o)] [skill name]',
    num_args: 1,
    args_to_lower: true,
    needs_api: false,
    has_state: false,
    async execute(message, args, extra) {
        const fs = require('fs');
        const path = require('path');

        const sanitizeInput = (input) => {
            return input.replace(/[^a-zA-Z0-9_\s]/g, '').trim();
        };

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

                    if (key === 'SKILLUSECLASS') {
                        if (skillData[key]) {
                            // Append to array if key already exists
                            if (Array.isArray(skillData[key])) {
                                skillData[key].push(value);
                            } else {
                                skillData[key] = [skillData[key], value];
                            }
                        } else {
                            skillData[key] = value;
                        }
                    } else {
                        // Handle multiple keys that can have multiple values
                        if (skillData[key]) {
                            if (Array.isArray(skillData[key])) {
                                skillData[key].push(value);
                            } else {
                                skillData[key] = [skillData[key], value];
                            }
                        } else {
                            skillData[key] = value;
                        }
                    }
                }
            }
            return skillData;
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
                const id = fields[0].trim();
                const name = fields[fields.length - 1].trim().toLowerCase();
                if (!skillNameToEntryIds[name]) {
                    skillNameToEntryIds[name] = [];
                }
                skillNameToEntryIds[name].push(parseInt(id));
            }

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

                // Get all entry IDs for the potential skill name
                const entryIds = skillNameToEntryIds[potentialSkillName.toLowerCase()] || [];

                if (entryIds.length === 0) {
                    continue; // No skill with this name, try next split
                }

                // Read the skills.tok file
                const skillsContent = fs.readFileSync(skillsFilePath, 'utf8');
                const skillsChunks = skillsContent.split(/\n\s*\n/);

                // For each skill chunk, collect matching skills
                matchingSkills = [];
                for (const chunk of skillsChunks) {
                    if (chunk.includes('SKILLCREATE:')) {
                        const skillData = parseSkillChunk(chunk);
                        if (skillData['SKILLDISPLAYNAMEID'] && entryIds.includes(parseInt(skillData['SKILLDISPLAYNAMEID']))) {
                            let skillClasses = skillData['SKILLUSECLASS'] || ['Unknown'];
                            if (!Array.isArray(skillClasses)) {
                                skillClasses = [skillClasses];
                            }
                            // Check if the skill matches the potential class name (if provided)
                            if (potentialClassName) {
                                if (skillClasses.some(cls => cls.toLowerCase() === potentialClassName.toLowerCase())) {
                                    matchingSkills.push({
                                        entryId: parseInt(skillData['SKILLDISPLAYNAMEID']),
                                        chunk: chunk.trim(),
                                        classNames: skillClasses,
                                        skillData: skillData // Include skillData for later use
                                    });
                                }
                            } else {
                                // No class name specified, collect all matching skills
                                matchingSkills.push({
                                    entryId: parseInt(skillData['SKILLDISPLAYNAMEID']),
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
                    skillName = potentialSkillName;
                    foundMatchingSkills = true;
                    break; // Exit the loop as we've found matching skills
                }
            }

            if (!foundMatchingSkills) {
                message.channel.send({ content: `No skill named '${args.slice(index).join(' ')}' found in '${modName}'.` });
                return;
            }

            // Build a map of IDs to text from lookuptext_eng.txt
            const lookupTextMap = {};
            for (const line of lookupLines) {
                if (!line.trim()) continue;
                const fields = line.split('^');
                const id = fields[0].trim();
                const text = fields[fields.length - 1].trim();
                lookupTextMap[id] = text;
            }

            // After finding the firstSkill
            const firstSkill = matchingSkills[0];
            const skillData = firstSkill.skillData; // Use the skillData we already parsed
            const skillDescription = generateSkillDescription(skillData, lookupTextMap);

            // Prepare the response
            let response = `Skill details for '${skillName}' in '${modName}' for class '${skillData['SKILLUSECLASS']}'`;
            
            response += `:\n${skillDescription}`;

            const allClassNames = matchingSkills.flatMap(skill => skill.classNames);
            const uniqueClassNames = [...new Set(allClassNames.map(cls => cls.toLowerCase()))];

            const firstSkillClassNames = firstSkill.classNames.map(cls => cls.toLowerCase());

            const otherClasses = uniqueClassNames.filter(cls => !firstSkillClassNames.includes(cls) && cls !== 'unknown');

            if (otherClasses.length > 0) {
                response += `\nOther classes that share this skill name: ${otherClasses.join(', ')}`;
            }

            // Send the response
            message.channel.send({ content: response });

        } catch (error) {
            this.logger.error('Error finding the skill:', error);
            message.channel.send({ content: 'An error occurred while finding the skill.' });
        }
    }
};
// Function to generate natural language description of a skill
const generateSkillDescription = (skillData, lookupTextMap) => {
    let description = '-# In game description:\n';

    // Skill Name
    const skillNameId = skillData['SKILLDISPLAYNAMEID'];
    const skillName = lookupTextMap[skillNameId] || 'Unknown Skill';
    description += `**${skillName}**\n`;

    // Skill Description
    const skillDescId = skillData['SKILLDESCRIPTIONID'];
    const skillDesc = lookupTextMap[skillDescId] || '';
    if (skillDesc) {
        description += `*${skillDesc}*

`;
    }
    description += '-# Skills.tok Information:\n';
    // Skill Type and Category
    if (skillData['SKILLCREATE']) {
        const skillCreateParts = skillData['SKILLCREATE'].split(',');
        const skillType = skillCreateParts[1]?.trim().replace(/"/g, '');
        const skillCategory = skillCreateParts[2]?.trim().replace(/"/g, '');
        if (skillType && skillCategory) {
            description += `**Type:** ${skillType} (${skillCategory})\n`;
        } else if (skillType) {
            description += `**Type:** ${skillType}\n`;
        }
    }

    // Job Point Cost
    if (skillData['SKILLJOBPOINTCOST']) {
        description += `**Job Point Cost:** ${skillData['SKILLJOBPOINTCOST']}\n`;
    }

    // Skill Attributes
    let hasWeaponAttribute = false;
    let hasMultiHitAttribute = false;
    let hasMoveToAttackAttribute = false;
    if (skillData['SKILLATTRIBUTE']) {
        let attributes = skillData['SKILLATTRIBUTE'];
        if (!Array.isArray(attributes)) {
            attributes = [attributes];
        }
        const relevantAttributes = attributes.filter(attr => [
            'affinity',
            'cantmiss',
            'charge',
            'melee',
            'movetoattack',
            'noninterface',
            'okwithnotargets',
            'piercing',
            'ranged',
            'shield',
            'spell',
            'suicide',
            'weapon'
        ].includes(attr));
        relevantAttributes.forEach(attr => {
            switch (attr) {
                case 'affinity':
                    description += 'This skill is an affinity attack.\n';
                    break;
                case 'cantmiss':
                    description += 'This skill cannot miss or be blocked.\n';
                    break;
                case 'charge':
                    description += 'This skill moves the user to the target.\n';
                    break;
                case 'melee':
                    description += 'This skill requires the user to be in melee range.\n';
                    break;
                case 'movetoattack':
                    description += 'This skill allows the user to move before making their attack.\n';
                    hasMoveToAttackAttribute = true;
                    break;
                case 'noninterface':
                    description += 'This skill triggers automatically based on an event.\n';
                    break;
                case 'okwithnotargets':
                    description += 'This skill can be cast even if there are no targets available.\n';
                    break;
                case 'piercing':
                    description += 'This skill is counted as **piercing** and deals reduced damage to Fleshless Targets.\n';
                    break;
                case 'ranged':
                    description += 'This skill can be used from range.\n';
                    break;
                case 'shield':
                    description += 'This skill uses the equipped shield to hit. It can apply effects that the shield inflicts.\n';
                    break;
                case 'spell':
                    description += 'This skill is counted as a spell and deals bonus damage to Fleshless Targets.\n';
                    break;
                case 'suicide':
                    description += 'This skill kills the user after applying its effect.\n';
                    break;
                case 'weapon':
                    description += 'This skill uses the equipped weapon to hit. It can apply effects that the weapon inflicts.\n';
                    hasWeaponAttribute = true;
                    break;
            }
        });
    }

    // Skill Costs
    if (skillData['SKILLCOSTS']) {
        const skillCostsParts = skillData['SKILLCOSTS'].split(',').map(part => part.trim());
        const turns = skillCostsParts[0];
        const sp = skillCostsParts[1] / 10;
        let costDescription = `The skill costs ${turns} turn${turns !== '1' ? 's' : ''}`;
        if (sp > 0) {
            costDescription += ` and uses ${sp}SP`;
        }
        if (skillData['SKILLAFFCOST']) {
            const affinityOrbs = skillData['SKILLAFFCOST'] / 20;
            costDescription += ` and ${affinityOrbs} affinity orb${affinityOrbs !== 1 ? 's' : ''}`;
            if (skillData['SKILLAFFINITY']) {
                const affinityType = skillData['SKILLAFFINITY'].toLowerCase();
                costDescription += ` (${affinityType})`;
            }
        }
        description += `**Costs:** ${costDescription}\n`;
    }

    // Combat Modifiers
    let baseDamageModifier = 0;
    if (skillData['SKILLCOMBATMODS']) {
        const combatModsParts = skillData['SKILLCOMBATMODS'].split(',').map(part => part.trim());
        const accuracyModifier = combatModsParts[0];
        baseDamageModifier = parseFloat(combatModsParts[1]);
        const damageType = hasWeaponAttribute ? 'total DAM' : 'total PWR';
        const accuracyText = parseFloat(accuracyModifier) === 0 ? 'with no changes to accuracy' : `with a ${accuracyModifier.startsWith('-') ? '' : '+'}${accuracyModifier} to accuracy`;
        description += `**Combat Modifiers:** This skill deals ${baseDamageModifier * 100}% ${damageType} per hit ${accuracyText}\n`;
    }

    // Multi-Hit Data
    if (hasMultiHitAttribute && skillData['SKILLMULTIHITDATA']) {
        const multiHitData = skillData['SKILLMULTIHITDATA'].split(',').map(part => part.trim());
        const numberOfHits = multiHitData.reduce((acc, hit) => acc + hit.length, 0);
        const uniqueUnitsHit = new Set(multiHitData.join('')).size;
        const damageType = hasWeaponAttribute ? 'total DAM' : 'total PWR';
        const totalDamage = baseDamageModifier * numberOfHits * 100;
        const hitDescriptions = multiHitData.map((hit, index) => {
            let description = '';
            if (hit.includes('A')) description += 'front-left, ';
            if (hit.includes('B')) description += 'in front, ';
            if (hit.includes('C')) description += 'front-right, ';
            if (hit.includes('D')) description += 'right, ';
            if (hit.includes('E')) description += 'back-right, ';
            if (hit.includes('F')) description += 'behind, ';
            if (hit.includes('G')) description += 'back-left, ';
            if (hit.includes('H')) description += 'left, ';
            return `Hit ${index + 1}: ${description.slice(0, -2)}`;
        }).join(' | ');
        description += `**Multi-Hit:** Hits ${uniqueUnitsHit} total ${uniqueUnitsHit === 1 ? 'person' : 'people'} across ${numberOfHits} hits for ${totalDamage}% ${damageType}. **Hitting**: ${hitDescriptions}\n`;
    }

    // Move to Attack
    if (hasMoveToAttackAttribute && skillData['SKILLMOVETOATTACKMOD']) {
        const moveToAttackMod = parseInt(skillData['SKILLMOVETOATTACKMOD'], 10);
        const movementText = moveToAttackMod > 0 ? `${moveToAttackMod} more` : `${Math.abs(moveToAttackMod)} less`;
        description += `**Move to Attack:** This unit can move to attack with ${movementText} ${Math.abs(moveToAttackMod) === 1 ? 'space' : 'spaces'} of movement\n`;
    }

    // Range
    if (skillData['SKILLRANGE']) {
        const skillRangeParts = skillData['SKILLRANGE'].split(',').map(part => part.trim());
        const range = skillRangeParts[0];
        const pattern = skillRangeParts[1]?.replace(/"/g, '');

        if (parseInt(range) === 0 && skillData['SKILLEFFECTRANGE'] && skillData['SKILLEFFECTCONDITION']) {
            const effectRangeParts = skillData['SKILLEFFECTRANGE'].split(',').map(part => part.trim());
            const effectRange = effectRangeParts[0];
            const effectPattern = effectRangeParts[1]?.replace(/"/g, '');
            let effectConditions = Array.isArray(skillData['SKILLEFFECTCONDITION']) ? skillData['SKILLEFFECTCONDITION'] : [skillData['SKILLEFFECTCONDITION']];
            effectConditions = effectConditions.map(cond => cond.replace(/"/g, ''));
            let effectCondition = effectConditions.find(cond => ['friend only not self', 'friend only', 'all units not self', 'enemy only'].includes(cond)) || '';
            if (effectCondition) {
                switch (effectCondition) {
                    case 'friend only not self':
                        effectCondition = 'all allies but not themselves';
                        break;
                    case 'friend only':
                        effectCondition = 'all allies';
                        break;
                    case 'all units not self':
                        effectCondition = 'everyone but themselves';
                        break;
                    case 'enemy only':
                        effectCondition = 'all enemies';
                        break;
                }
            }
            description += `**Range:** The skill casts from the user and affects ${effectCondition} in a ${effectRange} range ${effectPattern}\n`;
        } else {
            description += `**Range:** The skill can choose a target within ${range} tile${range !== '1' ? 's' : ''} in a ${pattern}\n`;
        }
    }

    // Prerequisites
    if (skillData['SKILLPREREQ']) {
        description += `**Prerequisites:** ${skillData['SKILLPREREQ']}\n`;
    }

    // Effects
    if (skillData['SKILLEFFECT']) {
        let effects = skillData['SKILLEFFECT'];
        if (!Array.isArray(effects)) {
            effects = [effects];
        }
        description += `**Effects:** ${effects.join(', ')}\n`;
    }

    // Status Effects
    if (skillData['SKILLSTATUS']) {
        let statuses = skillData['SKILLSTATUS'];
        if (!Array.isArray(statuses)) {
            statuses = [statuses];
        }
        description += `**Status Effects:** ${statuses.join(', ')}\n`;
    }

    return description;
};
