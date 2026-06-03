export const COMPARISONS = [
  {
    id: 'besok-lankklick',
    label: 'GA Besök vs Meta Länkklick',
    description: 'Jämför sajtbesök (Google Analytics) med länkklick från Meta-inlägg',
    seriesA: {
      label: 'GA Besök',
      color: '#2563EB',
      style: 'solid',
    },
    seriesB: {
      label: 'Meta Länkklick',
      color: '#DC2626',
      style: 'dashed',
    },
    disclaimer: 'Besök (GA) och Länkklick (Meta) mäter delvis olika saker. Länkklick räknar klick på länken i inlägget och påverkas inte av cookie-nekande. Besök inkluderar trafik från alla källor (andras delningar, sökmotorer m.m.), men tappar besökare som nekar cookies.',
    fetchMethod: 'getComparisonBesokLankklick',
  },
];

export const DEFAULT_COMPARISON = 'besok-lankklick';
