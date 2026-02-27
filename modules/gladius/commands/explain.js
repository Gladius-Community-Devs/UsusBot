const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');

// CODE CHANGE: parseSkillChunk is now defined at the top level so it can be reused.
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
            // Keys that can have multiple values
            const multiValueKeys = [
                'SKILLATTRIBUTE',
                'SKILLSTATUS',
                'SKILLEFFECT',
                'SKILLUSECLASS',
                'SKILLMULTIHITDATA',
                'SKILLEFFECTCONDITION'
            ];
            if (multiValueKeys.includes(key)) {
                if (skillData[key]) {
                    if (Array.isArray(skillData[key])) {
                        skillData[key].push(value);
                    } else {
                        skillData[key] = [skillData[key], value];
                    }
                } else {
                    skillData[key] = value;
                }
            } else {
                skillData[key] = value;
            }
        }
    }
    return skillData;
};

// CODE CHANGE: New helper function to parse the combo chain and return additional hit damage as numbers.
function parseComboChain(skillData, skillsChunks) {
    let totalComboDamage = 0;
    let additionalHits = []; // Array to hold damage modifier (as a number) for each additional hit.
    let currentSkill = skillData;

    // Determine the maximum additional hits from the initial SKILLMETER.
    // For example, SKILLMETER: "Chain", 0, 3 means 3 hits total so 2 additional hits.
    let meterParts = currentSkill['SKILLMETER']
        ? currentSkill['SKILLMETER'].split(',').map(s => s.trim().replace(/"/g, ''))
        : [];
    const maxAdditionalHits = meterParts.length >= 3 ? parseInt(meterParts[2], 10) - 1 : 0;
    let hitNumber = 1; // hitNumber = 1 for the first additional hit.

    while (hitNumber <= maxAdditionalHits && currentSkill['SKILLSUBSKILL']) {
        const subSkillName = currentSkill['SKILLSUBSKILL'];
        let foundSubSkill = null;
        for (const chunk of skillsChunks) {
            if (chunk.includes('SKILLCREATE:')) {
                const subSkillData = parseSkillChunk(chunk);
                if (subSkillData['SKILLCREATE'] && subSkillData['SKILLCREATE'].includes(subSkillName)) {
                    foundSubSkill = subSkillData;
                    break;
                }
            }
        }
        if (!foundSubSkill) break;
        // Extract additional damage modifier from the sub-skill's SKILLCOMBATMODS.
        if (foundSubSkill['SKILLCOMBATMODS']) {
            const mods = foundSubSkill['SKILLCOMBATMODS'].split(',').map(s => s.trim());
            const damageModifier = parseFloat(mods[1]) || 0;
            totalComboDamage += damageModifier;
            additionalHits.push(damageModifier);
        }
        currentSkill = foundSubSkill;
        hitNumber++;
    }
    return { totalComboDamage, additionalHits };
}

// CODE CHANGE: Updated generateSkillDescription to accept skillsChunks and output a reformatted combo chain breakdown.
const generateSkillDescription = (skillData, lookupTextMap, skillsChunks) => {
    let description = '';

    // Skill Name and Description
    const skillNameId = skillData['SKILLDISPLAYNAMEID'];
    const skillName = lookupTextMap[skillNameId] || 'Unknown Skill';
    description += `**${skillName}**\n`;
    const skillDescId = skillData['SKILLDESCRIPTIONID'];
    const skillDesc = skillDescId ? lookupTextMap[skillDescId] || '' : '';
    if (skillDesc) {
        description += `*${skillDesc}*\n\n`;
    }
    description += '-# Skills.tok Information:\n';

    // Skill Type and Category
    if (skillData['SKILLCREATE']) {
        // Fix for SKILLCREATE - handle both array and string
        const skillCreateValue = Array.isArray(skillData['SKILLCREATE'])
            ? skillData['SKILLCREATE'][0]
            : skillData['SKILLCREATE'];

        const skillCreateParts = skillCreateValue.split(',');
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
    let hasMoveToAttackAttribute = false;
    let hasTeleportAttribute = false;
    if (skillData['SKILLATTRIBUTE']) {
        let attributes = skillData['SKILLATTRIBUTE'];
        if (!Array.isArray(attributes)) {
            attributes = [attributes];
        }
        const relevantAttributes = attributes.filter(attr => [
            'affinity', 'cantmiss', 'charge', 'melee', 'movetoattack',
            'noninterface', 'okwithnotargets', 'piercing', 'ranged',
            'shield', 'spell', 'suicide', 'weapon', 'teleport'
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
        let skillCostsParts;

        // Handle SKILLCOSTS whether it's a string or array
        if (Array.isArray(skillData['SKILLCOSTS'])) {
            skillCostsParts = skillData['SKILLCOSTS'][0].split(',').map(part => part.trim());
        } else {
            skillCostsParts = skillData['SKILLCOSTS'].split(',').map(part => part.trim());
        }

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
                // Handle SKILLAFFINITY whether it's a string or array
                const affinityValue = Array.isArray(skillData['SKILLAFFINITY'])
                    ? skillData['SKILLAFFINITY'][0]
                    : skillData['SKILLAFFINITY'];

                let affinityType = typeof affinityValue === 'string' ? affinityValue.toLowerCase() : 'unknown';
                affinityType = affinityType === 'none' ? 'any' : affinityType;
                costDescription += ` (${affinityType})`;
            }
        }
        description += `**Costs:** ${costDescription}\n`;
    }

    // Combat Modifiers (Base)
    let baseDamageModifier = 0;
    let damageType = hasWeaponAttribute ? 'total DAM' : 'total PWR';
    if (skillData['SKILLCOMBATMODS']) {
        // Ensure SKILLCOMBATMODS is handled properly whether it's an array or string
        const skillCombatModsValue = Array.isArray(skillData['SKILLCOMBATMODS'])
            ? skillData['SKILLCOMBATMODS'][0]
            : skillData['SKILLCOMBATMODS'];

        const combatModsParts = skillCombatModsValue.split(',').map(part => part.trim());
        const accuracyModifier = combatModsParts[0];
        baseDamageModifier = parseFloat(combatModsParts[1]) || 0;

        // Only show combat modifiers line if this is not a combo skill
        const isComboSkill = skillData['SKILLMETER'] &&
            (Array.isArray(skillData['SKILLMETER'])
                ? skillData['SKILLMETER'][0].includes('Chain')
                : skillData['SKILLMETER'].includes('Chain'));

        if (!isComboSkill) {
            const accuracyText = parseFloat(accuracyModifier) === 0
                ? 'with no changes to accuracy'
                : `with a ${accuracyModifier.startsWith('-') ? '' : '+'}${accuracyModifier} to accuracy`;
            description += `**Combat Modifiers:** This skill deals ${(baseDamageModifier * 100).toFixed(2)}% ${damageType} per hit ${accuracyText}\n`;
        }
    }

    // CODE CHANGE: Process combo chain - updated to handle array or string properties
    if (skillData['SKILLMETER'] &&
        (Array.isArray(skillData['SKILLMETER'])
            ? skillData['SKILLMETER'][0].includes('Chain')
            : skillData['SKILLMETER'].includes('Chain'))) {

        const { totalComboDamage, additionalHits } = parseComboChain(skillData, skillsChunks);
        if (additionalHits.length > 0) {
            const totalCombo = baseDamageModifier + totalComboDamage;
            description += `**Combo:** This combo deals a total of ${(totalCombo * 100).toFixed(0)}% ${damageType}\nBreakdown:\n`;
            description += `Hit 1: ${(baseDamageModifier * 100).toFixed(0)}%\n`;
            additionalHits.forEach((hitDamage, index) => {
                description += `Hit ${index + 2}: ${(hitDamage * 100).toFixed(0)}%\n`;
            });
        }
    }

    // Multi-Hit Data (if any)
    if (skillData['SKILLMULTIHITDATA']) {
        const multiHitData = skillData['SKILLMULTIHITDATA'].split(',').map(part => part.trim());
        const numberOfHits = multiHitData.reduce((acc, hit) => acc + hit.length, 0);
        const uniqueUnitsHit = new Set(multiHitData.join('')).size;
        const totalDamage = (baseDamageModifier * numberOfHits * 100).toFixed(2);
        const hitDescriptions = multiHitData.map((hit, index) => {
            let hitDesc = '';
            if (hit.includes('A')) hitDesc += 'front-left, ';
            if (hit.includes('B')) hitDesc += 'in front, ';
            if (hit.includes('C')) hitDesc += 'front-right, ';
            if (hit.includes('D')) hitDesc += 'right, ';
            if (hit.includes('E')) hitDesc += 'back-right, ';
            if (hit.includes('F')) hitDesc += 'behind, ';
            if (hit.includes('G')) hitDesc += 'back-left, ';
            if (hit.includes('H')) hitDesc += 'left, ';
            return `Hit ${index + 1}: ${hitDesc.slice(0, -2)}`;
        }).join(' | ');
        description += `**Multi-Hit:** Hits ${uniqueUnitsHit} total ${uniqueUnitsHit === 1 ? 'person' : 'people'} across ${numberOfHits} hits for ${totalDamage}% ${damageType}. **Hitting**: ${hitDescriptions}\n`;
    }

    // Move to Attack
    if (skillData['SKILLMOVETOATTACKMOD']) {
        const moveToAttackMod = parseInt(skillData['SKILLMOVETOATTACKMOD'], 10);
        const movementText = moveToAttackMod > 0 ? `${moveToAttackMod} more` : `${Math.abs(moveToAttackMod)} less`;
        description += `**Move to Attack:** This unit can move to attack with ${movementText} ${Math.abs(moveToAttackMod) === 1 ? 'space' : 'spaces'} of movement\n`;
    }

    // Range
    if (skillData['SKILLRANGE']) {
        // Handle SKILLRANGE whether it's a string or array
        const skillRangeValue = Array.isArray(skillData['SKILLRANGE'])
            ? skillData['SKILLRANGE'][0]
            : skillData['SKILLRANGE'];

        const skillRangeParts = skillRangeValue.split(',').map(part => part.trim());
        const range = skillRangeParts[0];
        const pattern = skillRangeParts[1]?.replace(/"/g, '');

        if (parseInt(range) === 0 && skillData['SKILLEFFECTRANGE'] && skillData['SKILLEFFECTCONDITION']) {
            // Handle SKILLEFFECTRANGE whether it's a string or array
            const effectRangeValue = Array.isArray(skillData['SKILLEFFECTRANGE'])
                ? skillData['SKILLEFFECTRANGE'][0]
                : skillData['SKILLEFFECTRANGE'];

            const effectRangeParts = effectRangeValue.split(',').map(part => part.trim());
            const effectRange = effectRangeParts[0];
            const effectPattern = effectRangeParts[1]?.replace(/"/g, '');

            let effectConditions = Array.isArray(skillData['SKILLEFFECTCONDITION'])
                ? skillData['SKILLEFFECTCONDITION']
                : [skillData['SKILLEFFECTCONDITION']];

            effectConditions = effectConditions.map(cond =>
                typeof cond === 'string' ? cond.replace(/"/g, '') : cond);
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
            effectCondition = effectCondition.slice(0, -2);
            description += `**Range:** The skill casts from the user and affects ${effectCondition} in a ${effectRange} range ${effectPattern}\n`;
        } else {
            let rangeDescription = `**Range:** The skill can choose a target within ${range} tile${range !== '1' ? 's' : ''} in a ${pattern}`;
            if (skillData['SKILLEXCLUDERANGE']) {
                // Handle SKILLEXCLUDERANGE whether it's a string or array
                const skillExcludeRangeValue = Array.isArray(skillData['SKILLEXCLUDERANGE'])
                    ? skillData['SKILLEXCLUDERANGE'][0]
                    : skillData['SKILLEXCLUDERANGE'];

                const skillExcludeRangeParts = skillExcludeRangeValue.split(',').map(part => part.trim());
                const excludeRange = skillExcludeRangeParts[0];
                const excludePattern = skillExcludeRangeParts[1]?.replace(/"/g, '');
                rangeDescription += ` and cannot attack within ${excludeRange} tile${excludeRange !== '1' ? 's' : ''} in a ${excludePattern} around themselves`;
            }
            if (skillData['SKILLPROJECTILEATTR']) {
                const projectileAttr = Array.isArray(skillData['SKILLPROJECTILEATTR'])
                    ? skillData['SKILLPROJECTILEATTR'][0]
                    : skillData['SKILLPROJECTILEATTR'];

                if (typeof projectileAttr === 'string' && projectileAttr.trim().replace(/"/g, '') === 'indirect') {
                    rangeDescription += ' and does not need line of sight';
                }
            }
            description += `${rangeDescription}\n`;
        }
    }

    // Teleport Range
    if (hasTeleportAttribute && skillData['SKILLMOVERANGE']) {
        const moveRangeValue = Array.isArray(skillData['SKILLMOVERANGE'])
            ? skillData['SKILLMOVERANGE'][0]
            : skillData['SKILLMOVERANGE'];

        if (typeof moveRangeValue === 'string') {
            const moveRangeParts = moveRangeValue.split(',').map(part => part.trim());
            const moveRange = moveRangeParts[0];
            const movePattern = moveRangeParts[1]?.replace(/"/g, '');
            description += `**Teleport Range:** Teleports the user within ${moveRange} tile${moveRange !== '1' ? 's' : ''} in a ${movePattern}\n`;
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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('explain')
        .setDescription('Gives a natural language description of a skill')
        .addStringOption(opt =>
            opt.setName('skill_name')
                .setDescription('The skill name to explain')
                .setRequired(true))
        .addStringOption(opt =>
            opt.setName('class_name')
                .setDescription('Filter to a specific class (optional)')
                .setRequired(false))
        .addStringOption(opt =>
            opt.setName('mod_name')
                .setDescription('Mod name to search in (optional, defaults to Vanilla)')
                .setAutocomplete(true)),
    name: 'explain',
    needs_api: false,
    has_state: false,
    async autocomplete(interaction) {
        const fs = require('fs');
        const path = require('path');
        const focused = interaction.options.getFocused().toLowerCase();
        const moddersConfigPath = path.join(__dirname, '../modders.json');
        const choices = ['Vanilla'];
        try {
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));
            for (const modder in moddersConfig) {
                choices.push(moddersConfig[modder].replace(/\s+/g, '_'));
            }
        } catch {}
        const filtered = choices.filter(c => c.toLowerCase().includes(focused)).slice(0, 25);
        await interaction.respond(filtered.map(c => ({ name: c, value: c })));
    },
    async execute(interaction, extra) {
        await interaction.deferReply();
        const fs = require('fs');
        const path = require('path');

        // Adjusted sanitizeInput to allow apostrophes and hyphens.
        const sanitizeInput = (input) => {
            return input.replace(/[^\w\s'’-]/g, '').trim();
        };

        const moddersConfigPath = path.join(__dirname, '../modders.json');
        let modName = 'Vanilla';

        try {
            const moddersConfig = JSON.parse(fs.readFileSync(moddersConfigPath, 'utf8'));
            const modNameInput = interaction.options.getString('mod_name');
            if (modNameInput) {
                const sanitizedModInput = sanitizeInput(modNameInput);
                for (const modder in moddersConfig) {
                    const modConfigName = moddersConfig[modder].replace(/\s+/g, '_').toLowerCase();
                    if (modConfigName === sanitizedModInput.replace(/\s+/g, '_').toLowerCase()) {
                        modName = moddersConfig[modder].replace(/\s+/g, '_');
                        break;
                    }
                }
            }
            modName = path.basename(sanitizeInput(modName));

            const baseUploadsPath = path.join(__dirname, '../../../uploads');
            const modPath = path.join(baseUploadsPath, modName);
            const lookupFilePath = path.join(modPath, 'data', 'config', 'lookuptext_eng.txt');
            const skillsFilePath = path.join(modPath, 'data', 'config', 'skills.tok');

            if (!fs.existsSync(lookupFilePath)) {
                await interaction.editReply({ content: `That mod does not have files yet!` });
                return;
            }
            if (!fs.existsSync(skillsFilePath)) {
                await interaction.editReply({ content: `That mod is missing its skills.tok file!` });
                return;
            }

            const lookupContent = fs.readFileSync(lookupFilePath, 'utf8');
            const lookupLines = lookupContent.split(/\r?\n/);
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

            const skillsContent = fs.readFileSync(skillsFilePath, 'utf8');
            const skillsChunks = skillsContent.split(/\n\s*\n/);

            const skillName = sanitizeInput(interaction.options.getString('skill_name'));
            const className = sanitizeInput(interaction.options.getString('class_name') || '');

            const entryIds = skillNameToEntryIds[skillName.toLowerCase()] || [];
            if (entryIds.length === 0) {
                await interaction.editReply({ content: `No skill named '${skillName}' found in '${modName}'.` });
                return;
            }

            let matchingSkills = [];
            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = parseSkillChunk(chunk);
                    const skillDisplayNameId = skillData['SKILLDISPLAYNAMEID'];
                    if (skillDisplayNameId && entryIds.includes(parseInt(skillDisplayNameId))) {
                        let skillClasses = skillData['SKILLUSECLASS'] || ['Unknown'];
                        if (!Array.isArray(skillClasses)) skillClasses = [skillClasses];
                        if (className) {
                            if (skillClasses.some(cls => cls.toLowerCase() === className.toLowerCase())) {
                                matchingSkills.push({ entryId: parseInt(skillDisplayNameId), chunk: chunk.trim(), classNames: skillClasses, skillData });
                            }
                        } else {
                            matchingSkills.push({ entryId: parseInt(skillDisplayNameId), chunk: chunk.trim(), classNames: skillClasses, skillData });
                        }
                    }
                }
            }

            if (matchingSkills.length === 0) {
                await interaction.editReply({ content: `No skill named '${skillName}'${className ? ` for class '${className}'` : ''} found in '${modName}'.` });
                return;
            }

            const targetSKILLDISPLAYNAMEID = matchingSkills[0].entryId;
            const targetSKILLUSECLASS = matchingSkills[0].classNames[0];
            let allMatchingSkills = [];
            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = parseSkillChunk(chunk);
                    const skillDisplayNameId = skillData['SKILLDISPLAYNAMEID'];
                    if (skillDisplayNameId && parseInt(skillDisplayNameId) === targetSKILLDISPLAYNAMEID) {
                        let skillClasses = skillData['SKILLUSECLASS'] || ['Unknown'];
                        if (!Array.isArray(skillClasses)) skillClasses = [skillClasses];
                        if (skillClasses.some(cls => cls.toLowerCase() === targetSKILLUSECLASS.toLowerCase())) {
                            allMatchingSkills.push({ entryId: targetSKILLDISPLAYNAMEID, chunk: chunk.trim(), classNames: skillClasses, skillData });
                        }
                    }
                }
            }
            matchingSkills = allMatchingSkills;

            let allClassesWithSkillName = new Set();
            for (const chunk of skillsChunks) {
                if (chunk.includes('SKILLCREATE:')) {
                    const skillData = parseSkillChunk(chunk);
                    const skillDisplayNameId = skillData['SKILLDISPLAYNAMEID'];
                    if (skillDisplayNameId) {
                        const entryId = parseInt(skillDisplayNameId);
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
            const matchingSkillClassNames = matchingSkills.flatMap(skill => skill.classNames.map(cls => cls.toLowerCase()));
            const otherClasses = [...allClassesWithSkillName].filter(cls => !matchingSkillClassNames.includes(cls) && cls !== 'unknown');

            let messages = [];
            // Updated header with specific skill command
            let currentClass = matchingSkills[0].classNames[0];
            let header = `This is **WIP** and is missing some details beyond damage numbers. For more info try **/skill${modName !== 'Vanilla' ? ' mod_name:' + modName : ''} skill_name:${skillName}${currentClass ? ' class_name:' + currentClass : ''}**\n\n\nSkill details for '${skillName}' in '${modName}' for class '${currentClass}':\n\n`;
            let currentMessage = header;
            const lookupTextMap = {};
            for (const line of lookupLines) {
                if (!line.trim()) continue;
                const fields = line.split('^');
                const id = fields[0].trim();
                const text = fields[fields.length - 1].trim();
                lookupTextMap[id] = text;
            }

            // CODE CHANGE: Pass skillsChunks into generateSkillDescription to process combo chains.
            for (const skill of matchingSkills) {
                const skillDescription = generateSkillDescription(skill.skillData, lookupTextMap, skillsChunks);
                const skillText = `${skillDescription}\n`;
                if (currentMessage.length + skillText.length > 2000) {
                    messages.push(currentMessage);
                    currentMessage = skillText;
                } else {
                    currentMessage += skillText;
                }
            }

            // Remove the text listing of "Other classes" since we have a dropdown now
            if (currentMessage.length > 0) {
                messages.push(currentMessage);
            }

            // Create dropdown menus for class selection
            const allClasses = [...new Set([...matchingSkillClassNames, ...otherClasses])];

            // URL encode the modName and skillName for safe inclusion in customId
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
                    .setCustomId(`explain-select|${encodedModName}|${encodedSkillName}|${i}`)
                    .setPlaceholder('Select a class')
                    .addOptions(optionsChunk);
                const row = new ActionRowBuilder().addComponents(selectMenu);
                rows.push(row);
            }

            // Send messages (editReply for first, followUp for rest)
            for (const [msgIdx, msg] of messages.entries()) {
                const isFirst = msgIdx === 0;
                const isLast = msgIdx === messages.length - 1;
                const sendFn = isFirst
                    ? interaction.editReply.bind(interaction)
                    : interaction.followUp.bind(interaction);

                if (isLast) {
                    await sendFn({ content: msg, components: rows });
                } else {
                    await sendFn({ content: msg });
                }
            }
        } catch (error) {
            console.error('Error finding the skill:', error);
            if (interaction.deferred) await interaction.editReply({ content: 'An error occurred while finding the skill.' });
            else await interaction.reply({ content: 'An error occurred while finding the skill.', ephemeral: true });
        }
    },
    generateSkillDescription // Exporting for potential reuse.
};
