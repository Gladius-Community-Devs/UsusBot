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

        // Adjusted sanitizeInput to allow apostrophes and hyphens
        const sanitizeInput = (input) => {
            return input.replace(/[^\w\s'’-]/g, '').trim();
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

                    // Store all values as arrays
                    if (!skillData[key]) {
                        skillData[key] = [];
                    }
                    skillData[key].push(value);
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

            // Prepare the response
            let messages = [];
            let header = `Skill details for '${skillName}' in '${modName}' for class '${matchingSkills[0].classNames[0]}'` + ':\n\n';
            let currentMessage = header;

            // Build a map of IDs to text from lookuptext_eng.txt
            const lookupTextMap = {};
            for (const line of lookupLines) {
                if (!line.trim()) continue;
                const fields = line.split('^');
                const id = fields[0].trim();
                const text = fields[fields.length - 1].trim();
                lookupTextMap[id] = text;
            }

            // Generate descriptions for all matching skills
            for (const skill of matchingSkills) {
                const skillDescription = generateSkillDescription(skill.skillData, lookupTextMap);
                const skillText = `${skillDescription}\n`;

                if (currentMessage.length + skillText.length > 2000) {
                    messages.push(currentMessage);
                    currentMessage = skillText;
                } else {
                    currentMessage += skillText;
                }
            }

            // Add other classes info
            if (otherClasses.length > 0) {
                const classesText = `Other classes that have a skill with the same name: ${otherClasses.join(', ')}`;
                if (currentMessage.length + classesText.length > 2000) {
                    messages.push(currentMessage);
                    currentMessage = classesText;
                } else {
                    currentMessage += classesText;
                }
            }

            if (currentMessage.length > 0) {
                messages.push(currentMessage);
            }

            // Send the messages
            for (const msg of messages) {
                await message.channel.send({ content: msg });
            }

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
    let hasTeleportAttribute = false;
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
            'weapon',
            'teleport'
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
                case 'teleport':
                    hasTeleportAttribute = true;
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
                let affinityType = skillData['SKILLAFFINITY'].toLowerCase();
                affinityType = affinityType === 'none' ? 'any' : affinityType;
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
        baseDamageModifier = parseFloat(combatModsParts[1]).toFixed(2);
        const damageType = hasWeaponAttribute ? 'total DAM' : 'total PWR';
        const accuracyText = parseFloat(accuracyModifier) === 0 ? 'with no changes to accuracy' : `with a ${accuracyModifier.startsWith('-') ? '' : '+'}${accuracyModifier} to accuracy`;
        description += `**Combat Modifiers:** This skill deals ${(baseDamageModifier * 100).toFixed(2)}% ${damageType} per hit ${accuracyText}\n`;
    }

    // Multi-Hit Data
    if (hasMultiHitAttribute && skillData['SKILLMULTIHITDATA']) {
        const multiHitData = skillData['SKILLMULTIHITDATA'].split(',').map(part => part.trim());
        const numberOfHits = multiHitData.reduce((acc, hit) => acc + hit.length, 0);
        const uniqueUnitsHit = new Set(multiHitData.join('')).size;
        const damageType = hasWeaponAttribute ? 'total DAM' : 'total PWR';
        const totalDamage = (baseDamageModifier * numberOfHits * 100).toFixed(2);
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
            let effectCondition = '';
            effectConditions.forEach(cond => {
                if (cond.startsWith('targetstatus ign')) {
                    const status = cond.split(' ')[2];
                    effectCondition += `units who are not ${status}, `;
                } else if (cond.startsWith('targetstatus req')) {
                    const status = cond.split(' ')[2];
                    effectCondition += `units who are ${status}, `;
                } else {
                    switch (cond) {
                        case 'friend only not self':
                            effectCondition += 'all allies but not themselves, ';
                            break;
                        case 'friend only':
                            effectCondition += 'all allies, ';
                            break;
                        case 'all units not self':
                            effectCondition += 'everyone but themselves, ';
                            break;
                        case 'enemy only':
                            effectCondition += 'all enemies, ';
                            break;
                    }
                }
            });
            effectCondition = effectCondition.slice(0, -2); // Remove trailing comma and space
            description += `**Range:** The skill casts from the user and affects ${effectCondition} in a ${effectRange} range ${effectPattern}\n`;
        } else {
            let rangeDescription = `**Range:** The skill can choose a target within ${range} tile${range !== '1' ? 's' : ''} in a ${pattern}`;

            if (skillData['SKILLEXCLUDERANGE']) {
                const skillExcludeRangeParts = skillData['SKILLEXCLUDERANGE'].split(',').map(part => part.trim());
                const excludeRange = skillExcludeRangeParts[0];
                const excludePattern = skillExcludeRangeParts[1]?.replace(/"/g, '');
                rangeDescription += ` and cannot attack within ${excludeRange} tile${excludeRange !== '1' ? 's' : ''} in a ${excludePattern} around themselves`;
            }

            if (skillData['SKILLPROJECTILEATTR'] && skillData['SKILLPROJECTILEATTR'].trim().replace(/"/g, '') === 'indirect') {
                rangeDescription += ' and does not need line of sight';
            }

            description += `${rangeDescription}\n`;
        }
    }

    // Teleport Range
    if (hasTeleportAttribute && skillData['SKILLMOVERANGE']) {
        const moveRangeParts = skillData['SKILLMOVERANGE'].split(',').map(part => part.trim());
        const moveRange = moveRangeParts[0];
        const movePattern = moveRangeParts[1]?.replace(/"/g, '');
        description += `**Teleport Range:** Teleports the user within ${moveRange} tile${moveRange !== '1' ? 's' : ''} in a ${movePattern}\n`;
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
