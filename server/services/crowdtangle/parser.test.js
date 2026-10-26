import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFilename, parseLeaderboard, selectRows, parseCount, accountKey } from './parser.js';

test('filename with export timestamp', () => {
  const r = parseFilename('2023-09-05-09-13-57-CEST-facebook_leaderboard_Sveriges-Radio_2023-08-01_00-00-00_CET_2023-08-31_23-59-59_CET.csv');
  assert.equal(r.ok, true);
  assert.equal(r.platform, 'facebook');
  assert.equal(r.list, 'Sveriges-Radio');
  assert.equal(r.month, '2023-08');
  assert.equal(r.exportedAt, '2023-09-05T07:13:57.000Z');
  assert.equal(r.exportDateSource, 'filename');
});

test('filename without timestamp, underscores and dash separator', () => {
  const r = parseFilename('facebook_leaderboard_Sveriges_Radio_2018-01-01_00-00-00_CET-2018-01-31_23-59-59_CET.csv');
  assert.equal(r.ok, true);
  assert.equal(r.list, 'Sveriges-Radio');
  assert.equal(r.month, '2018-01');
  assert.equal(r.exportedAt, null);
  const r2 = parseFilename('dir text instagram_leaderboard_P4_Lokalkanaler_2018-03-01_00-00-00_CET-2018-03-31_23-59-59_CEST.csv');
  assert.equal(r2.ok, true);
  assert.equal(r2.list, 'P4-Lokalkanaler');
});

test('non-month periods are rejected', () => {
  assert.equal(parseFilename('facebook_leaderboard_Sveriges-Radio_2019-12-31_23-00-00_CET_2020-12-31_22-59-59_CET.csv').reason, 'not_one_month');
  assert.equal(parseFilename('facebook_leaderboard_Sveriges-Radio_2023-01-01_00-00-00_CET_2023-03-31_23-59-59_CEST.csv').reason, 'not_one_month');
  assert.equal(parseFilename('facebook_leaderboard_Sveriges-Radio_2023-02-01_00-00-00_CET_2023-02-27_23-59-59_CET.csv').reason, 'not_one_month');
  assert.equal(parseFilename('facebook_leaderboard_Sveriges-Radio_2024-02-01_00-00-00_CET_2024-02-29_23-59-59_CET.csv').ok, true);
});

test('excluded lists are rejected', () => {
  for (const l of ['Svensk-media', 'SR_Grupper', 'SR-Grupper', 'CoronaSR', 'Stora_varumärken_SR']) {
    assert.equal(parseFilename(`facebook_leaderboard_${l}_2023-01-01_00-00-00_CET_2023-01-31_23-59-59_CET.csv`).reason, 'excluded_list');
  }
});

test('parseCount handles thousands, percent and N/A', () => {
  assert.equal(parseCount('287,537'), 287537);
  assert.equal(parseCount('--'), null);
  assert.equal(parseCount('3.22%'), null);
  assert.equal(parseCount(''), null);
  assert.equal(parseCount('0'), 0);
});

test('account keys', () => {
  assert.equal(accountKey('facebook', 'https://www.facebook.com/219032915954'), '219032915954');
  assert.equal(accountKey('facebook', 'https://www.facebook.com/SomeSlug/'), 'SomeSlug');
  assert.equal(accountKey('instagram', 'https://www.instagram.com/P3Nyheter/'), 'p3nyheter');
  assert.equal(accountKey('twitter', 'https://twitter.com/Sr_Ekot', '@Sr_Ekot'), 'sr_ekot');
});

const FB_CSV = '﻿Page,Codename,URL,"Total Interactions",Likes,Comments,Shares,"Owned Total Views","All Reactions","Total Posts","Page Followers"\n' +
  'Radiosporten,Radiosporten,https://www.facebook.com/219032915954,"287,537","241,311","14,922","3,401","324,283","269,214",311,"42,206"\n' +
  'Min berättelse,x,https://www.facebook.com/399216630276376,0,0,0,0,--,0,No posts in this timeframe,--\n' +
  'Empty URL,x,,1,1,1,1,1,1,1,1\n' +
  'Averages,,,"14,699.57","10,753.63",1,1,1,1,92.78,"1"\n';

test('FB csv: BOM, quoted thousands, "--", Averages and empty URL skipped', () => {
  const rows = parseLeaderboard(FB_CSV, 'facebook');
  assert.equal(rows.length, 2);
  assert.deepEqual(
    { k: rows[0].account_key, i: rows[0].interactions, c: rows[0].comments, s: rows[0].shares, p: rows[0].posts, f: rows[0].followers, v: rows[0].video_views },
    { k: '219032915954', i: 287537, c: 14922, s: 3401, p: 311, f: 42206, v: 324283 });
  assert.equal(rows[1].video_views, null);
  assert.equal(rows[1].followers, null);
  assert.equal(rows[1].posts, 0);
});

test('IG semicolon csv, missing columns become null', () => {
  const csv = 'Account;Codename;URL;Total Interactions;Likes;Comments;Views;Total Posts;Followers\n' +
    'P3Nyheter;p3nyheter;https://www.instagram.com/p3nyheter/;586,576;571,065;15,511;48,760;182;53,177\n' +
    'Averages;;;1;1;1;1;1;1\n';
  const rows = parseLeaderboard(csv, 'instagram');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].account_key, 'p3nyheter');
  assert.equal(rows[0].interactions, 586576);
  assert.equal(rows[0].shares, null);
  assert.equal(rows[0].video_views, 48760);
});

test('twitter: retweets go to shares, handle is key', () => {
  const csv = 'Account,Handle,URL,"Total Interactions",Retweets,Likes,"Total Tweets",Followers\n' +
    '"SR Ekot",@sr_ekot,https://twitter.com/sr_ekot,"5,875","2,301","3,574",670,"82,527"\n';
  const [r] = parseLeaderboard(csv, 'twitter');
  assert.equal(r.account_key, 'sr_ekot');
  assert.equal(r.shares, 2301);
  assert.equal(r.likes, 3574);
  assert.equal(r.posts, 670);
  assert.equal(r.comments, null);
});

const cand = (at, src, interactions) => ({ platform: 'facebook', account_key: 'a', month: '2023-08', exported_at: at, export_date_source: src, interactions });

test('selection: closest export at or after month end', () => {
  const r = selectRows([
    cand('2023-08-20T10:00:00Z', 'filename', 1),
    cand('2023-09-05T10:00:00Z', 'filename', 2),
    cand('2023-09-01T10:00:00Z', 'filename', 3),
    cand('2024-01-01T10:00:00Z', 'filename', 4),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].interactions, 3);
});

test('selection: nothing after month end → latest', () => {
  const r = selectRows([cand('2023-08-10T00:00:00Z', 'filename', 1), cand('2023-08-20T00:00:00Z', 'filename', 2)]);
  assert.equal(r[0].interactions, 2);
});

test('selection: filename-dated beats mtime-dated', () => {
  const r = selectRows([cand('2023-09-01T00:00:00Z', 'mtime', 1), cand('2023-10-01T00:00:00Z', 'filename', 2)]);
  assert.equal(r[0].interactions, 2);
  const r2 = selectRows([cand('2023-09-01T00:00:00Z', 'mtime', 1), cand('2023-09-03T00:00:00Z', 'mtime', 2)]);
  assert.equal(r2[0].interactions, 1);
});

test('full calendar year is recognised, quarters and shifted years stay rejected', () => {
  const y = parseFilename('2023-01-16-10-51-25-CET-facebook_leaderboard_Sveriges-Radio_2022-01-01_00-00-00_CET_2022-12-31_23-59-59_CET.csv');
  assert.equal(y.ok, true);
  assert.equal(y.period, 'year');
  assert.equal(y.year, '2022');
  assert.equal(y.month, undefined);
  assert.equal(y.exportDateSource, 'filename');
  const old = parseFilename('facebook_leaderboard_Sveriges_Radio_2014-01-01_00-00-00_CET-2014-12-31_23-59-59_CET.csv');
  assert.equal(old.period, 'year');
  assert.equal(old.exportedAt, null);
  assert.equal(parseFilename('facebook_leaderboard_Sveriges-Radio_2022-01-01_00-00-00_CET_2022-03-31_23-59-59_CEST.csv').reason, 'not_one_month');
  assert.equal(parseFilename('facebook_leaderboard_Sveriges-Radio_2022-01-01_00-00-00_CET_2022-11-30_23-59-59_CET.csv').reason, 'not_one_month');
  const m = parseFilename('facebook_leaderboard_Sveriges-Radio_2022-05-01_00-00-00_CET_2022-05-31_23-59-59_CEST.csv');
  assert.equal(m.period, 'month');
  assert.equal(m.month, '2022-05');
});

test('yearly FB/IG/Twitter headers parse (no-followers → null)', () => {
  const fb = 'Page,Codename,URL,"Total Interactions",Likes,Comments,Shares,"Total Posts","Page Likes"\n' +
    'Ekot,x,https://www.facebook.com/ekot,"1,234,567","1,000,000","100,000","134,567","2,345","500,000"\n';
  const [f] = parseLeaderboard(fb, 'facebook');
  assert.equal(f.interactions, 1234567);
  assert.equal(f.posts, 2345);
  assert.equal(f.followers, null); // "Page Likes" is a different measure; not mapped to followers
  const ig = 'Account,Codename,URL,"Total Interactions",Likes,Comments,Views,"Total Posts",Followers\n' +
    'p3nyheter,x,https://www.instagram.com/p3nyheter/,"900,000","880,000","20,000",--,300,No followers\n';
  const [i] = parseLeaderboard(ig, 'instagram');
  assert.equal(i.account_key, 'p3nyheter');
  assert.equal(i.interactions, 900000);
  assert.equal(i.followers, null);
  const tw = 'Account,Handle,URL,"Total Interactions",Retweets,Likes,"Total Tweets",Followers\n' +
    'SR Ekot,@sr_ekot,https://twitter.com/sr_ekot,"60,000","20,000","40,000","8,000","82,527"\n';
  const [t] = parseLeaderboard(tw, 'twitter');
  assert.equal(t.account_key, 'sr_ekot');
  assert.equal(t.posts, 8000);
});

test('selection: yearly candidates group by year and use Dec 31 as period end', () => {
  const y = (at, src, interactions, year = '2022') => ({ platform: 'facebook', account_key: 'a', year, exported_at: at, export_date_source: src, interactions });
  const r = selectRows([
    y('2022-12-20T00:00:00Z', 'filename', 1),
    y('2023-01-16T00:00:00Z', 'filename', 2),
    y('2023-06-01T00:00:00Z', 'filename', 3),
    y('2023-01-16T00:00:00Z', 'filename', 9, '2021'),
  ]);
  assert.equal(r.length, 2);
  assert.equal(r.find(x => x.year === '2022').interactions, 2);
  const r2 = selectRows([y('2018-03-01T00:00:00Z', 'mtime', 1, '2017'), y('2018-04-01T00:00:00Z', 'mtime', 2, '2017')]);
  assert.equal(r2[0].interactions, 1);
});
