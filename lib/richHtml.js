/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * richHtml.js — Engine kirim rich HTML bot tanpa prompt "verifikasi unduh".
 *
 * Pakai: import { sendRichHtml } from '../../lib/richHtml.js'
 *        await sendRichHtml(ctx, htmlPayload)
 */
import crypto from 'node:crypto'

const SIG_MATERIAL = Buffer.from('HitoriMD.V1.0-VerificationSignature.Metadata')
const CERT_MATERIAL = Buffer.from('HitoriMD.V1.0-CertificateChain.Metadata')

export function generateVerificationMetadata() {
  const signature = Buffer.concat([SIG_MATERIAL, crypto.randomBytes(64 - SIG_MATERIAL.length)]).toString('base64')
  const certificateChain = [
    Buffer.concat([CERT_MATERIAL, crypto.randomBytes(684 - CERT_MATERIAL.length)]).toString('base64'),
    Buffer.concat([CERT_MATERIAL, crypto.randomBytes(892 - CERT_MATERIAL.length)]).toString('base64')
  ]
  return { proofs: [{ version: 1, useCase: 1, signature, certificateChain }] }
}

export function normalizeTrustedSources(sources = []) {
  const out = []
  const seen = new Set()
  for (const entry of Array.isArray(sources) ? sources : [sources]) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (!trimmed) continue
    let normalized = trimmed
    try {
      const parsed = new URL(trimmed)
      normalized = parsed.origin && parsed.origin !== 'null' ? parsed.origin : trimmed
    } catch {}
    if (!seen.has(normalized)) {
      seen.add(normalized)
      out.push(normalized)
    }
  }
  return out
}

export function buildHtmlRichContent(html, { withVerification = true, trustedSources = [] } = {}) {
  const safeTrustedSources = normalizeTrustedSources(trustedSources)
  const richResponseMessage = {
    messageType: 1,
    unifiedResponse: {
      data: Buffer.from(
        JSON.stringify({
          __typename: 'GenAIUnifiedResponse',
          response_id: crypto.randomUUID(),
          sections: [
            {
              __typename: 'GenAIUnifiedResponseSection',
              view_model: {
                __typename: 'GenAISingleLayoutViewModel',
                primitive: {
                  __typename: 'FOAHtmlPrimitiveDemoDONOTUSE',
                  trusted_sources: safeTrustedSources,
                  payload: html
                }
              }
            }
          ]
        })
      ).toString('base64')
    },
    contextInfo: withVerification
      ? {
          forwardingScore: 1,
          isForwarded: true,
          forwardedAiBotMessageInfo: { botJid: '236911050403982@bot' },
          forwardOrigin: 4
        }
      : {
          isForwarded: true,
          forwardOrigin: 4
        }
  }

  return {
    ...(withVerification
      ? {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
            botMetadata: {
              messageDisclaimerText: '',
              verificationMetadata: generateVerificationMetadata(),
              botResponseId: crypto.randomUUID()
            }
          }
        }
      : {}),
    botForwardedMessage: {
      message: {
        richResponseMessage
      }
    }
  }
}

export const buildRichContent = buildHtmlRichContent

export async function sendRichHtml(ctx, html, opts = {}) {
  const withEdit = opts.withEdit !== false
  const withVerification = opts.withVerification !== false
  const trustedSources = opts.trustedSources || []
  const content = buildHtmlRichContent(html, { withVerification, trustedSources })

  const sent = await ctx.client.message.send(ctx.chat, content, {
    additionalAttributes: { type: 'text' }
  })
  const id = sent?.id || sent?.key?.id || null
  console.log('[RichHtml] sent | id=' + (id || '?'))

  if (!id || !withEdit) return sent

  try {
    await ctx.client.message.send(
      ctx.chat,
      {
        botForwardedMessage: {
          message: {
            protocolMessage: {
              key: { remoteJid: ctx.chat, fromMe: true, id },
              type: 14,
              editedMessage: content
            }
          }
        }
      },
      { additionalAttributes: { type: 'text' } }
    )
    console.log('[RichHtml] bypass-edit OK | target=' + id)
  } catch (e) {
    console.log('[RichHtml] bypass-edit fail:', String(e?.message || e).slice(0, 120))
  }

  return sent
}
