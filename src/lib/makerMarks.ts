// Model makers' marks for the leaderboard rows and bars: Claude in its coral, DeepSeek in its
// blue, OpenAI and Kimi in currentColor so they follow the theme.
import { siDeepseek, siKimi } from 'simple-icons';
import { claude, openai } from './protocolMarks';

export const makerMarks = {
  claude: { d: claude, box: '0 0 24 24', fill: '#D97757' },
  openai: { d: openai, box: '0 0 90 90', fill: 'currentColor' },
  deepseek: { d: siDeepseek.path, box: '0 0 24 24', fill: `#${siDeepseek.hex}` },
  kimi: { d: siKimi.path, box: '0 0 24 24', fill: 'currentColor' },
} as const;
export type Maker = keyof typeof makerMarks;
