/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * testrich.js — Demo Advanced AI Rich Response
 * Submessages: text (2) • code block (5) • tabel (4) • LaTeX (8) • footer (2)
 */
import config from '../../config.js'
import { subText, subTable, subLatex, sendSubRich } from '../../lib/aiRich.js'

export default {
  name: 'testrich',
  aliases: ['richdemo', 'aidemo'],
  tags: 'tools',
  description: 'Demo rich response AI: teks, code block, tabel, LaTeX',

  async run(ctx) {
    await sendSubRich(ctx, [
      subText(`🚀 *${config.botName.toUpperCase()} RICH RESPONSE DEMO*\n_${config.botName} AI Protocol_`),
      {
        messageType: 5,
        codeMetadata: {
          codeLanguage: 'javascript',
          codeBlocks: [
            { highlightType: 1, codeContent: 'const ' },
            { highlightType: 0, codeContent: 'bot = ' },
            { highlightType: 3, codeContent: `'${config.botName} x Zapo-JS'` },
            { highlightType: 0, codeContent: ';\n' },
            { highlightType: 2, codeContent: 'console.log' },
            { highlightType: 0, codeContent: '(bot);' }
          ]
        }
      },
      subTable(
        [
          ['Feature', 'Zapo', 'Native'],
          ['Rich Text', 'Full', 'Yes'],
          ['Code Block', 'Full', 'Yes'],
          ['Table', 'Experimental', 'Yes'],
          ['LaTeX', 'Text-Only', 'No']
        ],
        'Feature Comparison'
      ),
      subLatex('Math formula demo: ', [
        { latexExpression: 'E = mc^2', width: 100, height: 50 }
      ]),
      subText(`\n> _*Powered by ${config.botName}*_`)
    ])

    await ctx.react('🚀')
  }
}
