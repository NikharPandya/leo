const figmaApiExporter = require('figma-api-exporter').default
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
const { optimize } = require('svgo')

const RAW_FOLDER = './icons-raw'
const FINAL_FOLDER = './icons'

fs.mkdirSync(RAW_FOLDER, { recursive: true })
fs.mkdirSync(FINAL_FOLDER, { recursive: true })

if (!process.env.FIGMA_API_TOKEN) {
  throw new Error(
    `In order to work, this script requires a figma API token to be set in the 'FIGMA_API_TOKEN' environment variable. You can get one from here https://www.figma.com/developers/api#access-tokens and set it with 'export FIGMA_API_TOKEN=<YOUR_API_TOKEN>'`
  )
}

const getFlag = (iconName) => {
  const regionRegex = /Country=Region - ((\w|\s)+).svg/
  let match = regionRegex.exec(iconName)
  if (match) {
    return `${match[1]}`
  }

  const countryRegex = /Country=(\w\w\w?).*\.svg/
  match = countryRegex.exec(iconName)
  if (!match) return false

  return match[1]?.toUpperCase()
}

const getMutatedIconName = (iconName) => {
  const flag = getFlag(iconName)
  if (flag) {
    return `Country=${flag}.svg`
  }
  return iconName.toLowerCase()
}

const mutateIcon = (iconName) => {
  const closingTag = '</svg>'
  let iconContent = fs.readFileSync(path.join(RAW_FOLDER, iconName)).toString()
  // Note: Sometimes Figma includes an additional closing tag, which kills our parser.
  iconContent = iconContent.substring(
    0,
    iconContent.indexOf(closingTag) + closingTag.length
  )

  const {
    window: { document }
  } = new JSDOM(iconContent, { contentType: 'image/svg+xml' })
  const svg = document.querySelector('svg')
  if (!svg) {
    console.error(`Icon ${iconName} has no SVG element`)
    return
  }

  const outputName = getMutatedIconName(iconName)

  const rejectReasons = new Set()
  const result = optimize(svg.outerHTML, {
    multipass: true,
    plugins: [
      'preset-default',
      'removeDimensions',
      {
        name: 'banRasterImageElement',
        fn: () => ({
          element: {
            enter: (node) => {
              if (
                node.name === 'image' &&
                node.attributes['xlink:href'] != null &&
                /(\.|image\/)(jpg|png|gif)/.test(node.attributes['xlink:href'])
              ) {
                rejectReasons.add('has a raster image element')
              }
            }
          }
        })
      },
      'removeOffCanvasPaths',
      'removeScriptElement'
    ]
  })

  // If we have any reason to reject the icon don't copy it to the output directory.
  if (rejectReasons.size) {
    console.log(
      `Ignoring icon ${outputName} because:\n${Array.from(rejectReasons)
        .map((r) => `- ${r}`)
        .join('\n')}`
    )
    return
  }
  fs.writeFileSync(path.join(FINAL_FOLDER, outputName), result.data)
}

const mutateIcons = () => {
  const iconNames = fs.readdirSync(RAW_FOLDER)
  for (const icon of iconNames) {
    if (!icon.endsWith('.svg')) continue
    mutateIcon(icon)
  }
}

const generateMeta = () => {
  const icons = fs
    .readdirSync(FINAL_FOLDER)
    .filter((f) => f.endsWith('.svg'))
    .map((f) => path.basename(f, '.svg'))
    .reduce((prev, next) => ({ ...prev, [next]: next }), {})
  const meta = {
    updatedAt: Date.now(),
    icons
  }

  const stringified = JSON.stringify(meta, null, 2)

  // Write meta.js
  fs.writeFileSync(
    path.join(FINAL_FOLDER, 'meta.js'),
    `export default ${stringified}`
  )

  // Write meta.d.ts
  fs.writeFileSync(
    path.join(FINAL_FOLDER, 'meta.d.ts'),
    `import { StringWithAutoComplete } from '../src/types/string'

type Meta = ${stringified}
export default Meta
export type IconName = StringWithAutoComplete<keyof Meta['icon']>`
  )
}

const exporter = figmaApiExporter(process.env.FIGMA_API_TOKEN)

exporter
  .getSvgs({
    fileId: 'g8Z0q6TMPYDq6zXh9Y7LWD',
    canvas: '🔮 Icons'
  })
  .then(async (svgsData) => {
    await exporter.downloadSvgs({
      saveDirectory: RAW_FOLDER,
      svgsData: svgsData.svgs,
      lastModified: svgsData.lastModified
    })
  })
  .then(mutateIcons)
  .then(generateMeta)
