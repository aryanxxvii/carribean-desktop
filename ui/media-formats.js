const hasAudio = (file, matches) => file?.audioFormats?.some(matches);

export const formatGroups = {
  Edition: [
    ['imax', 'IMAX', (file) => file?.edition === 'IMAX' || file?.edition === 'IMAX Enhanced', 'IMAX'],
    ['imaxEnhanced', 'IMAX Enhanced', (file) => file?.edition === 'IMAX Enhanced', 'IMAX', 'Enhanced']
  ],
  Resolution: ['8K', '4K', '1440p', '1080p', '720p'].map((label) =>
    [label, label, (file) => file?.resolution === label]),
  'Dynamic range': [
    ['vision', 'Dolby Vision', (file) => file?.formats?.includes('Dolby Vision'), 'Dolby Vision'],
    ...['HDR10+', 'HDR10', 'HLG', 'SDR'].map((label) => [label, label, (file) => file?.formats?.includes(label)]),
    ['hdr', 'Any HDR', (file) => file?.formats?.some((format) => format !== 'SDR')]
  ],
  Audio: [
    ['atmos', 'Dolby Atmos', (file) => hasAudio(file, (format) => format.startsWith('Dolby Atmos ·')), 'Dolby Atmos'],
    ['dts', 'DTS', (file) => hasAudio(file, (format) => format.startsWith('DTS')), 'DTS'],
    ['dtsHD', 'DTS-HD Master Audio', (file) => hasAudio(file, (format) => /DTS-HD.*(?:MA|Master Audio)/i.test(format)), 'DTS', 'HD MA'],
    ['dtsX', 'DTS:X', (file) => hasAudio(file, (format) => format.replace(/ · DTS:X tagged$/, '').includes('DTS:X')), 'DTS', ':X'],
    ['digital', 'Dolby Digital', (file) => hasAudio(file, (format) => format.split(' · ')[0] === 'Dolby Digital'), 'Dolby Digital'],
    ['digitalPlus', 'Dolby Digital Plus', (file) => hasAudio(file, (format) => format.split(' · ')[0] === 'Dolby Digital Plus'), 'Dolby Digital Plus']
  ]
};

export const mediaFormats = Object.values(formatGroups).flat();
export const homeFormats = ['imax', 'imaxEnhanced', '4K', 'vision', 'atmos', 'hdr', 'HDR10+', 'dtsHD', 'dtsX', 'dts', '1080p'];

export const formatMarks = {
  'Dolby Atmos': 'dolby-atmos.svg',
  'Dolby Vision': 'dolby-vision.svg',
  'Dolby Digital': 'dolby-digital.png',
  'Dolby Digital Plus': 'dolby-digital-plus.png',
  IMAX: 'imax.png',
  DTS: 'dts.png'
};
