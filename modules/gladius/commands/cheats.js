const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cheats')
        .setDescription('Outputs all known Gladius cheat codes'),
    name: 'cheats',
    needs_api: false,
    has_state: false,
    async execute(interaction, extra) {
        const cheats =
"```" +
`NOTE FOR PLAYSTATION 2 USERS:
These cheats are listed using GameCube/Xbox button names.
Remap buttons on PS2 as follows:
A = X
B = O
X = Square
Y = Triangle

All cheats are entered while the game is PAUSED in the appropriate menu or context.

--------------------------------
Free Dinars / Gold (School):
Right, Down, Left, Up, Left x4, Y, Left

Free Experience (1000 EXP to all gladiators) (School):
Right, Down, Left, Up, Left x4, Y, Right

No Equipment Limitations (School):
Right, Down, Left, Up, Left x4, Y x3

Defensive Affinity Up (In Battle Menu):
Down, Right, Up, Left x5, Y, Left

Offensive Affinity Up (In Battle Menu):
Down, Right, Up, Left x5, Y, Right

Raise HP for Character (In Battle Menu):
Down, Right, Up, Left x5, Y, Up

Higher Level Enemies (School):
Right x3, Up x2, Left x4, Right, Up x4, Down

Lower Level Enemies (School):
Right x3, Up x2, Left x4, Right, Down x4, Up

Make Timer Normal Speed (Timed Battles) (School):
Right, Up, Left, Down, Left x4, Up, Down

Make Timer Faster (Timed Battles) (School):
Right, Up, Left, Down, Left x4, Down, Up

Pull Back the Camera (In Battle Menu):
Up x2, Left, Down, Right, Left x4, Up x4

Team Berserk (In Battle Menu):
Left, Down, Right, Up, Left x4, Up, Right, Down, Left

Turn All Random Encounters OFF (World Map):
Right, Left, Up, Down, Left x4, Y x3

Turn All Random Encounters ON (World Map):
Right, Left, Up, Down, Left x4, A x3` +
"```";

        await interaction.reply({ content: cheats });
    }
};
