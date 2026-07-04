import sharp from 'sharp'
import { writeFileSync } from 'fs'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 128" fill="none" width="560" height="128">
  <rect width="560" height="128" fill="#0a0a0a"/>
  <!-- Mark: converging chain sources resolving into a checkmark (settled) -->
  <g transform="scale(2) translate(0, 0)">
    <line x1="3" y1="14" x2="30" y2="30" stroke="#00d4aa" stroke-width="2" stroke-linecap="round" opacity="0.45"/>
    <line x1="3" y1="32" x2="30" y2="32" stroke="#00d4aa" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
    <line x1="3" y1="50" x2="30" y2="34" stroke="#00d4aa" stroke-width="2" stroke-linecap="round" opacity="0.45"/>
    <circle cx="3" cy="14" r="3" fill="#00d4aa" opacity="0.45"/>
    <circle cx="3" cy="32" r="3" fill="#00d4aa" opacity="0.7"/>
    <circle cx="3" cy="50" r="3" fill="#00d4aa" opacity="0.45"/>
    <circle cx="32" cy="32" r="17" fill="none" stroke="#00d4aa" stroke-width="1.5" opacity="0.25"/>
    <path d="M23 33 L30 41 L44 20" stroke="#00d4aa" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </g>
  <!-- Wordmark -->
  <text x="152" y="84"
    font-family="'Courier New', monospace"
    font-size="56" font-weight="700" letter-spacing="-1" fill="#e8e8e8">settle</text>
  <!-- PAY superscript -->
  <text x="464" y="52"
    font-family="Arial, sans-serif"
    font-size="18" font-weight="500" letter-spacing="3" fill="#00d4aa" opacity="0.8">PAY</text>
</svg>`

const pngBuffer = await sharp(Buffer.from(SVG)).png().toBuffer()
writeFileSync('public/settle-logo.png', pngBuffer)
console.log('settle-logo.png written to public/')

// Also write a smaller version (280x64)
const svgSmall = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 64" fill="none" width="280" height="64">
  <rect width="280" height="64" fill="#0a0a0a"/>
  <g>
    <line x1="3" y1="14" x2="30" y2="30" stroke="#00d4aa" stroke-width="2" stroke-linecap="round" opacity="0.45"/>
    <line x1="3" y1="32" x2="30" y2="32" stroke="#00d4aa" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
    <line x1="3" y1="50" x2="30" y2="34" stroke="#00d4aa" stroke-width="2" stroke-linecap="round" opacity="0.45"/>
    <circle cx="3" cy="14" r="3" fill="#00d4aa" opacity="0.45"/>
    <circle cx="3" cy="32" r="3" fill="#00d4aa" opacity="0.7"/>
    <circle cx="3" cy="50" r="3" fill="#00d4aa" opacity="0.45"/>
    <circle cx="32" cy="32" r="17" fill="none" stroke="#00d4aa" stroke-width="1.5" opacity="0.25"/>
    <path d="M23 33 L30 41 L44 20" stroke="#00d4aa" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </g>
  <text x="76" y="42"
    font-family="'Courier New', monospace"
    font-size="28" font-weight="700" letter-spacing="-0.5" fill="#e8e8e8">settle</text>
  <text x="232" y="26"
    font-family="Arial, sans-serif"
    font-size="9" font-weight="500" letter-spacing="1.5" fill="#00d4aa" opacity="0.8">PAY</text>
</svg>`

const pngSmall = await sharp(Buffer.from(svgSmall)).png().toBuffer()
writeFileSync('public/settle-logo-sm.png', pngSmall)
console.log('settle-logo-sm.png written to public/')
