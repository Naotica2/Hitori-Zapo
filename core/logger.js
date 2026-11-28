/**
 * © Hitori-MD — WhatsApp Bot on Zapo-JS
 * logger.js — Logger estetik ala-ala wkk
 */
import { createPinoLogger } from 'zapo-js'
import config from '../config.js'

export const logger = await createPinoLogger({
  level: config.logLevel,
  pretty: true,
  formatters: {
    level: (label) => ({ level: label.toUpperCase() })
  },
  timestamp: () => `,"time":"${new Date().toLocaleTimeString('id-ID')}"`
})

// Adaptor agar signature Pino `(obj, msg)` dan Zapo `(msg, obj)` sama-sama tampil lengkap
for (const lvl of ['trace', 'debug', 'info', 'warn', 'error']) {
  const orig = logger[lvl].bind(logger)
  logger[lvl] = (first, second, ...rest) => {
    if (first && typeof first === 'object' && !(first instanceof Error) && typeof second === 'string') {
      return orig(second, first)
    }
    if (first instanceof Error) {
      return orig(typeof second === 'string' ? second : first.message, { err: first.message, stack: first.stack })
    }
    return orig(first, second, ...rest)
  }
}

logger.success = (msg, ...args) => {
  const ctx = args.length === 1 && typeof args[0] === 'object' ? args[0] : (args.length ? { args } : undefined)
  return logger.info(msg, ctx)
}

export const clientLogger = await createPinoLogger({
  level: config.libraryLogLevel ?? 'warn',
  pretty: true
})
