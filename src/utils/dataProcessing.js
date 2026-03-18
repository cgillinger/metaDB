/**
 * Data processing helpers for Meta Analytics views
 */
import { getAccountViewData, getPostViewData } from './storageService';

// Available fields per view - used by MainView for field selection
export const ACCOUNT_VIEW_FIELDS = {
  'views': 'Visningar',
  'average_reach': 'Genomsnittlig räckvidd',
  'interactions': 'Interaktioner',
  'engagement': 'Engagemang',
  'likes': 'Reaktioner',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  'saves': 'Sparade',
  'follows': 'Följare',
  'total_clicks': 'Totalt antal klick',
  'other_clicks': 'Övriga klick',
  'link_clicks': 'Länkklick',
  'post_count': 'Antal publiceringar',
  'posts_per_day': 'Publiceringar per dag'
};

export const POST_VIEW_FIELDS = {
  'description': 'Beskrivning',
  'publish_time': 'Publiceringstid',
  'views': 'Visningar',
  'reach': 'Räckvidd',
  'interactions': 'Interaktioner',
  'engagement': 'Engagemang',
  'likes': 'Reaktioner',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  'saves': 'Sparade',
  'follows': 'Följare',
  'total_clicks': 'Totalt antal klick',
  'other_clicks': 'Övriga klick',
  'link_clicks': 'Länkklick',
  'post_type': 'Typ'
};

export const getProcessedData = async () => {
  const accountViewData = getAccountViewData();
  const postViewData = await getPostViewData();
  return {
    rows: postViewData,
    accountViewData,
    postViewData
  };
};
