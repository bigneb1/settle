import sharp from 'sharp'
import { writeFileSync } from 'fs'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 128" fill="none" width="560" height="128">
  <rect width="560" height="128" fill="#0a0a0a"/>
  <!-- Mark: converging chain paths into single resolution node -->
  <g transform="scale(2) translate(0, 0)">
    <line x1="8" y1="40" x2="80" y2="64" stroke="#00d4aa" stroke-width="3" stroke-linecap="round" opacity="0.5"/>
    <line x1="8" y1="64" x2="80" y2="64" stroke="#00d4aa" stroke-width="3" stroke-linecap="round" opacity="0.75"/>
    <line x1="8" y1="88" x2="80" y2="64" stroke="#00d4aa" stroke-width="3" stroke-linecap="round" opacity="0.5"/>
    <circle cx="8" cy="40" r="5" fill="#00d4aa" opacity="0.5"/>
    <circle cx="8" cy="64" r="5" fill="#00d4aa" opacity="0.75"/>
    <circle cx="8" cy="88" r="5" fill="#00d4aa" opacity="0.5"/>
    <circle cx="80" cy="64" r="10" fill="#00d4aa"/>
    <circle cx="80" cy="64" r="16" fill="none" stroke="#00d4aa" stroke-width="2" opacity="0.3"/>
    <line x1="90" y1="64" x2="116" y2="64" stroke="#00d4aa" stroke-width="3" stroke-linecap="round"/>
    <polygon points="112,57 124,64 112,71" fill="#00d4aa"/>
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
    <line x1="4" y1="20" x2="40" y2="32" stroke="#00d4aa" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
    <line x1="4" y1="32" x2="40" y2="32" stroke="#00d4aa" stroke-width="1.5" stroke-linecap="round" opacity="0.75"/>
    <line x1="4" y1="44" x2="40" y2="32" stroke="#00d4aa" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
    <circle cx="4" cy="20" r="2.5" fill="#00d4aa" opacity="0.5"/>
    <circle cx="4" cy="32" r="2.5" fill="#00d4aa" opacity="0.75"/>
    <circle cx="4" cy="44" r="2.5" fill="#00d4aa" opacity="0.5"/>
    <circle cx="40" cy="32" r="5" fill="#00d4aa"/>
    <circle cx="40" cy="32" r="8" fill="none" stroke="#00d4aa" stroke-width="1" opacity="0.3"/>
    <line x1="45" y1="32" x2="58" y2="32" stroke="#00d4aa" stroke-width="1.5" stroke-linecap="round"/>
    <polygon points="56,28.5 62,32 56,35.5" fill="#00d4aa"/>
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
