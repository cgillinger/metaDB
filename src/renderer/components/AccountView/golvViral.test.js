// Enhetstester för golvViral.js med node:test + node:assert/strict
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  VIRAL_PARAMS,
  TUNT,
  VIRAL_SHARE_HIGH,
  MIN_PEERS,
  median,
  periodMedian,
  weeklyFloor,
  viralThreshold,
  isViral,
  reliability,
  viralShare,
  peerMedianOfMedians,
  floorLevel,
  floorTrend,
  statusVerdict,
} from './golvViral.js';

// ---------------------------------------------------------------------------
// Hjälpare: skapa en post med publish_time och reach
// ---------------------------------------------------------------------------
function post(publish_time, reach, post_type = 'video') {
  return { publish_time, reach, post_type };
}

// ---------------------------------------------------------------------------
// median
// ---------------------------------------------------------------------------
describe('median', () => {
  it('tom array → 0', () => {
    assert.equal(median([]), 0);
  });
  it('ett element', () => {
    assert.equal(median([7]), 7);
  });
  it('udda antal', () => {
    assert.equal(median([3, 1, 2]), 2);
  });
  it('jämnt antal → medel av de två mittersta', () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });
  it('negativa värden', () => {
    assert.equal(median([-4, -2, -1, -3]), -2.5);
  });
});

// ---------------------------------------------------------------------------
// periodMedian
// ---------------------------------------------------------------------------
describe('periodMedian', () => {
  it('tom → 0', () => {
    assert.equal(periodMedian([]), 0);
  });
  it('poolar ALLA posttyper – bara reach räknas', () => {
    const posts = [
      post('2026-01-01 10:00:00', 100, 'video'),
      post('2026-01-02 10:00:00', 200, 'image'),
      post('2026-01-03 10:00:00', 300, 'reel'),
    ];
    assert.equal(periodMedian(posts), 200);
  });
  it('jämnt antal poster', () => {
    const posts = [
      post('2026-01-01 10:00:00', 100),
      post('2026-01-02 10:00:00', 200),
      post('2026-01-03 10:00:00', 300),
      post('2026-01-04 10:00:00', 400),
    ];
    assert.equal(periodMedian(posts), 250);
  });
});

// ---------------------------------------------------------------------------
// weeklyFloor
// ---------------------------------------------------------------------------
describe('weeklyFloor', () => {
  it('tom → []', () => {
    assert.deepEqual(weeklyFloor([]), []);
  });

  it('poster med ogiltiga datum hoppas över', () => {
    const posts = [
      post('INVALID', 1000),
      post('2026-01-05 10:00:00', 500),
    ];
    const res = weeklyFloor(posts);
    assert.equal(res.length, 1);
    assert.equal(res[0].count, 1);
  });

  it('2026-01-01 ligger i ISO-vecka 1 år 2026', () => {
    const posts = [post('2026-01-01 12:00:00', 1000)];
    const res = weeklyFloor(posts);
    assert.equal(res.length, 1);
    assert.equal(res[0].isoYear, 2026);
    assert.equal(res[0].isoWeek, 1);
    assert.equal(res[0].weekKey, '2026-W01');
  });

  it('2025-12-29 ligger i ISO-vecka 1 år 2026 (årsgräns)', () => {
    // 2025-12-29 är måndag → ISO-vecka 1 2026 (samma vecka som 2026-01-01)
    const posts = [
      post('2025-12-29 08:00:00', 800),
      post('2026-01-01 12:00:00', 1200),
    ];
    const res = weeklyFloor(posts);
    assert.equal(res.length, 1, 'ska vara en enda ISO-vecka');
    assert.equal(res[0].isoYear, 2026);
    assert.equal(res[0].isoWeek, 1);
    assert.equal(res[0].weekKey, '2026-W01');
    // count ska vara 2
    assert.equal(res[0].count, 2);
  });

  it('date = veckans tidigaste inläggs ms-timestamp', () => {
    const earlyMs = new Date('2026-01-05 08:00:00').getTime();
    const lateMs  = new Date('2026-01-07 20:00:00').getTime();
    const posts = [
      post('2026-01-07 20:00:00', 500),
      post('2026-01-05 08:00:00', 700),
    ];
    const res = weeklyFloor(posts);
    assert.equal(res.length, 1);
    assert.equal(res[0].date, earlyMs);
  });

  it('median per vecka beräknas korrekt', () => {
    // Vecka med tre poster: reach 100, 200, 300 → median 200
    const posts = [
      post('2026-01-05 10:00:00', 100),
      post('2026-01-06 10:00:00', 200),
      post('2026-01-07 10:00:00', 300),
    ];
    const res = weeklyFloor(posts);
    assert.equal(res.length, 1);
    assert.equal(res[0].median, 200);
  });

  it('count = antal inlägg i veckan', () => {
    const posts = [
      post('2026-01-05 10:00:00', 100),
      post('2026-01-06 10:00:00', 200),
      post('2026-01-07 10:00:00', 300),
    ];
    const res = weeklyFloor(posts);
    assert.equal(res[0].count, 3);
  });

  it('sorteras stigande efter veckans datum', () => {
    // Vecka 3 2026: 2026-01-12..18; Vecka 2 2026: 2026-01-05..11
    const posts = [
      post('2026-01-15 10:00:00', 500), // vecka 3
      post('2026-01-08 10:00:00', 300), // vecka 2
      post('2026-01-01 10:00:00', 100), // vecka 1
    ];
    const res = weeklyFloor(posts);
    assert.equal(res.length, 3);
    assert.ok(res[0].date <= res[1].date, 'index 0 ska vara äldst');
    assert.ok(res[1].date <= res[2].date, 'index 1 ska vara näst äldst');
  });

  it('två separata veckor ger två poster i resultatet', () => {
    const posts = [
      post('2026-01-05 10:00:00', 100), // vecka 2
      post('2026-01-12 10:00:00', 200), // vecka 3
    ];
    const res = weeklyFloor(posts);
    assert.equal(res.length, 2);
  });
});

// ---------------------------------------------------------------------------
// viralThreshold
// ---------------------------------------------------------------------------
describe('viralThreshold', () => {
  it('FB: 85000 + 4.2 * median', () => {
    assert.equal(viralThreshold(1000, VIRAL_PARAMS.FB), 85000 + 4.2 * 1000);
  });
  it('IG: 40000 + 4.2 * median', () => {
    assert.equal(viralThreshold(1000, VIRAL_PARAMS.IG), 40000 + 4.2 * 1000);
  });
});

// ---------------------------------------------------------------------------
// isViral
// ---------------------------------------------------------------------------
describe('isViral', () => {
  it('reach > tröskeln → viral', () => {
    const threshold = viralThreshold(10000, VIRAL_PARAMS.FB);
    assert.ok(isViral(post('2026-01-01 10:00:00', threshold + 1), 10000, VIRAL_PARAMS.FB));
  });

  it('reach == tröskeln → viral (gränsfall)', () => {
    const threshold = viralThreshold(10000, VIRAL_PARAMS.FB);
    assert.ok(isViral(post('2026-01-01 10:00:00', threshold), 10000, VIRAL_PARAMS.FB));
  });

  it('reach strax under tröskeln → INTE viral', () => {
    const threshold = viralThreshold(10000, VIRAL_PARAMS.FB);
    assert.ok(!isViral(post('2026-01-01 10:00:00', threshold - 0.001), 10000, VIRAL_PARAMS.FB));
  });

  it('FB och IG ger olika trösklar för samma median', () => {
    const med = 5000;
    const fbThresh = viralThreshold(med, VIRAL_PARAMS.FB);
    const igThresh = viralThreshold(med, VIRAL_PARAMS.IG);
    assert.ok(fbThresh > igThresh, 'FB-tröskel ska vara högre än IG-tröskel');

    // En post som är viral på IG men inte på FB
    const p = post('2026-01-01 10:00:00', igThresh + 1);
    assert.ok(isViral(p, med, VIRAL_PARAMS.IG), 'ska vara viral på IG');
    // Säkra att reach faktiskt är under FB-tröskeln
    if (p.reach < fbThresh) {
      assert.ok(!isViral(p, med, VIRAL_PARAMS.FB), 'ska inte vara viral på FB');
    }
  });
});

// ---------------------------------------------------------------------------
// reliability
// ---------------------------------------------------------------------------
describe('reliability', () => {
  it('N < 20 → thin=true', () => {
    // 10 poster utspridda över 7 veckor
    const posts = Array.from({ length: 10 }, (_, i) =>
      post(`2026-01-${String(i + 1).padStart(2, '0')} 10:00:00`, 100),
    );
    const res = reliability(posts);
    assert.equal(res.n, 10);
    assert.ok(res.thin);
    assert.ok(res.message !== null);
  });

  it('veckor < 6 → thin=true (även om N>=20)', () => {
    // 20 poster alla i samma vecka
    const posts = Array.from({ length: 20 }, () =>
      post('2026-01-05 10:00:00', 100),
    );
    const res = reliability(posts);
    assert.equal(res.n, 20);
    assert.ok(res.weeks < 6);
    assert.ok(res.thin);
  });

  it('N>=20 och veckor>=6 → thin=false, message=null', () => {
    // 21 poster i 7 olika veckor (3 poster per vecka)
    const dates = [
      '2026-01-05', '2026-01-06', '2026-01-07', // vecka 2
      '2026-01-12', '2026-01-13', '2026-01-14', // vecka 3
      '2026-01-19', '2026-01-20', '2026-01-21', // vecka 4
      '2026-01-26', '2026-01-27', '2026-01-28', // vecka 5
      '2026-02-02', '2026-02-03', '2026-02-04', // vecka 6
      '2026-02-09', '2026-02-10', '2026-02-11', // vecka 7
      '2026-02-16', '2026-02-17', '2026-02-18', // vecka 8
    ];
    const posts = dates.map((d) => post(`${d} 10:00:00`, 100));
    const res = reliability(posts);
    assert.equal(res.n, 21);
    assert.ok(res.weeks >= 6);
    assert.ok(!res.thin);
    assert.equal(res.message, null);
  });

  it('rätt message-text vid thin', () => {
    const posts = [post('2026-01-05 10:00:00', 100)];
    const res = reliability(posts);
    assert.equal(
      res.message,
      'Få inlägg i vald period – golvet blir osäkert. Välj en längre period för en stabilare bild.',
    );
  });

  it('returnerar korrekt antal veckor', () => {
    // Poster i 3 separata veckor
    const posts = [
      post('2026-01-05 10:00:00', 100), // vecka 2
      post('2026-01-12 10:00:00', 100), // vecka 3
      post('2026-01-19 10:00:00', 100), // vecka 4
    ];
    const res = reliability(posts);
    assert.equal(res.weeks, 3);
  });
});

// ---------------------------------------------------------------------------
// viralShare
// ---------------------------------------------------------------------------
describe('viralShare', () => {
  it('tom array → 0', () => {
    assert.equal(viralShare([], 0, VIRAL_PARAMS.FB), 0);
  });

  it('noll virala → 0', () => {
    // Alla poster är långt under tröskeln
    const posts = [
      post('2026-01-01 10:00:00', 1),
      post('2026-01-02 10:00:00', 2),
    ];
    assert.equal(viralShare(posts, 0, VIRAL_PARAMS.FB), 0);
  });

  it('alla poster är virala → 1', () => {
    const med = 0;
    const threshold = viralThreshold(med, VIRAL_PARAMS.IG);
    const posts = [
      post('2026-01-01 10:00:00', threshold + 100),
      post('2026-01-02 10:00:00', threshold + 200),
    ];
    assert.equal(viralShare(posts, med, VIRAL_PARAMS.IG), 1);
  });

  it('andel av total reach från virala poster', () => {
    const med = 0;
    // IG-tröskel = 40000 + 0 = 40000
    const posts = [
      post('2026-01-01 10:00:00', 50000), // viral (50000 >= 40000)
      post('2026-01-02 10:00:00', 10000), // ej viral
    ];
    const share = viralShare(posts, med, VIRAL_PARAMS.IG);
    // 50000 / 60000 ≈ 0.8333
    assert.ok(Math.abs(share - 50000 / 60000) < 1e-10);
  });

  it('total reach 0 → 0', () => {
    const posts = [
      post('2026-01-01 10:00:00', 0),
      post('2026-01-02 10:00:00', 0),
    ];
    assert.equal(viralShare(posts, 0, VIRAL_PARAMS.FB), 0);
  });
});

// ---------------------------------------------------------------------------
// peerMedianOfMedians
// ---------------------------------------------------------------------------
describe('peerMedianOfMedians', () => {
  it('null när < MIN_PEERS (5) konton', () => {
    assert.equal(peerMedianOfMedians([100, 200, 300, 400]), null);
  });

  it('null för tom array', () => {
    assert.equal(peerMedianOfMedians([]), null);
  });

  it('median-of-medians när >= MIN_PEERS', () => {
    // 5 värden: [100, 200, 300, 400, 500] → median = 300
    assert.equal(peerMedianOfMedians([100, 200, 300, 400, 500]), 300);
  });

  it('exakt MIN_PEERS konton → returnerar median', () => {
    assert.equal(peerMedianOfMedians([10, 20, 30, 40, 50]), 30);
  });

  it('fler än MIN_PEERS → returnerar median', () => {
    // 6 värden: [1, 2, 3, 4, 5, 6] → median = 3.5
    assert.equal(peerMedianOfMedians([1, 2, 3, 4, 5, 6]), 3.5);
  });
});

// ---------------------------------------------------------------------------
// floorLevel
// ---------------------------------------------------------------------------
describe('floorLevel', () => {
  it('peerMedian null → null', () => {
    assert.equal(floorLevel(1000, null), null);
  });

  it('accountMedian > peerMedian → "högt"', () => {
    assert.equal(floorLevel(5000, 3000), 'högt');
  });

  it('accountMedian == peerMedian → "högt"', () => {
    assert.equal(floorLevel(3000, 3000), 'högt');
  });

  it('accountMedian < peerMedian → "lågt"', () => {
    assert.equal(floorLevel(2000, 3000), 'lågt');
  });
});

// ---------------------------------------------------------------------------
// floorTrend
// ---------------------------------------------------------------------------
describe('floorTrend', () => {
  it('tom array → "→"', () => {
    assert.equal(floorTrend([]), '→');
  });

  it('ett element → "→"', () => {
    assert.equal(floorTrend([{ median: 100, date: 0 }]), '→');
  });

  it('stigande golv → "↑"', () => {
    // 6 veckor med tydligt ökande medianvärden
    const arr = [
      { median: 100, date: 1 },
      { median: 110, date: 2 },
      { median: 120, date: 3 },
      { median: 200, date: 4 },
      { median: 210, date: 5 },
      { median: 220, date: 6 },
    ];
    assert.equal(floorTrend(arr), '↑');
  });

  it('fallande golv → "↓"', () => {
    const arr = [
      { median: 200, date: 1 },
      { median: 210, date: 2 },
      { median: 220, date: 3 },
      { median: 100, date: 4 },
      { median: 110, date: 5 },
      { median: 120, date: 6 },
    ];
    assert.equal(floorTrend(arr), '↓');
  });

  it('platt golv → "→"', () => {
    const arr = [
      { median: 100, date: 1 },
      { median: 102, date: 2 },
      { median: 101, date: 3 },
      { median: 100, date: 4 },
      { median: 103, date: 5 },
      { median: 101, date: 6 },
    ];
    assert.equal(floorTrend(arr), '→');
  });

  it('exakt 5% ökning → "→" (gräns, ej > 1.05)', () => {
    // firstAvg = 100, lastAvg = 105  → 105 == 100*1.05, ej >1.05 → '→'
    const arr = [
      { median: 100, date: 1 },
      { median: 100, date: 2 },
      { median: 100, date: 3 },
      { median: 105, date: 4 },
      { median: 105, date: 5 },
      { median: 105, date: 6 },
    ];
    assert.equal(floorTrend(arr), '→');
  });

  it('> 5% ökning → "↑"', () => {
    const arr = [
      { median: 100, date: 1 },
      { median: 100, date: 2 },
      { median: 100, date: 3 },
      { median: 106, date: 4 },
      { median: 106, date: 5 },
      { median: 106, date: 6 },
    ];
    assert.equal(floorTrend(arr), '↑');
  });
});

// ---------------------------------------------------------------------------
// statusVerdict
// ---------------------------------------------------------------------------
describe('statusVerdict', () => {
  it('"högt" + ej många viraler → Golvbyggt', () => {
    assert.equal(
      statusVerdict('högt', 0.1),
      'Golvbyggt – levererar stabilt och brett, oberoende av viraler',
    );
  });

  it('"högt" + många viraler → Toppform', () => {
    assert.equal(
      statusVerdict('högt', VIRAL_SHARE_HIGH),
      'Toppform – stark bas och stort genomslag',
    );
  });

  it('"lågt" + ej många viraler → Störst potential', () => {
    assert.equal(
      statusVerdict('lågt', 0.1),
      'Störst potential att lyfta golvet – varken stabil bas eller genomslag ännu',
    );
  });

  it('"lågt" + många viraler → ostadig bas', () => {
    assert.equal(
      statusVerdict('lågt', 0.99),
      'Räckvidden vilar på enstaka viraler – ostadig bas',
    );
  });

  it('okänt floorLvl → tom sträng', () => {
    assert.equal(statusVerdict(null, 0.5), '');
    assert.equal(statusVerdict('medel', 0.5), '');
  });

  it('viralShare exakt på VIRAL_SHARE_HIGH → räknas som "många"', () => {
    // 0.40 >= 0.40 → manyViral = true
    assert.equal(
      statusVerdict('högt', 0.40),
      'Toppform – stark bas och stort genomslag',
    );
  });

  it('viralShare precis under VIRAL_SHARE_HIGH → räknas som "ej många"', () => {
    assert.equal(
      statusVerdict('högt', 0.399),
      'Golvbyggt – levererar stabilt och brett, oberoende av viraler',
    );
  });
});

// ---------------------------------------------------------------------------
// Konstantexport
// ---------------------------------------------------------------------------
describe('exporterade konstanter', () => {
  it('VIRAL_PARAMS.FB har rätt form', () => {
    assert.equal(VIRAL_PARAMS.FB.bas, 85000);
    assert.equal(VIRAL_PARAMS.FB.k, 4.2);
  });
  it('VIRAL_PARAMS.IG har rätt form', () => {
    assert.equal(VIRAL_PARAMS.IG.bas, 40000);
    assert.equal(VIRAL_PARAMS.IG.k, 4.2);
  });
  it('TUNT', () => {
    assert.equal(TUNT.minPoster, 20);
    assert.equal(TUNT.minVeckor, 6);
  });
  it('VIRAL_SHARE_HIGH = 0.40', () => {
    assert.equal(VIRAL_SHARE_HIGH, 0.40);
  });
  it('MIN_PEERS = 5', () => {
    assert.equal(MIN_PEERS, 5);
  });
});
