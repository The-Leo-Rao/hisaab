import QRCode from 'qrcode'

const opts = { errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0b1220', light: '#ffffff' } }

export const qrSvg = (text) => QRCode.toString(text, { ...opts, type: 'svg' })
export const qrPng = (text, width = 360) => QRCode.toBuffer(text, { ...opts, type: 'png', width })
