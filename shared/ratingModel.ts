/**
 * The "modeled" OTD method: a reverse-engineered, transparent model of how Real turns a player's game into
 *   (1) a game RATING   — an additive function of the box-score line (coefficient tables below, no black box), and
 *   (2) the OTD RAX     — `max(0, round(k × rating))` at General level, where k is a published per-sport factor
 *                         (×2 for playoffs / majors). Iconic payout = General × 150 (see shared/otdRules.ts).
 *
 * Everything here is pure (no fetch). `scripts/fit-rating-model.mjs` regenerates the two GENERATED blocks from Rateboard's
 * ground truth + ESPN stats; `docs/RATING-MODEL.md` explains the method and the measured error. Stat keys are the ones
 * produced by `scripts/lib/ratingData.mjs` from ESPN box scores / game logs:
 *   NBA / WNBA / CBB  pts reb ast stl blk tov pf fgm fga tpm tpa ftm fta
 *   NFL / CFB         pcmp patt pyds ptd pint sacked ratt ryds rtd rec tgt recyds rectd fuml fumrec tkl solo sacks tfl pd qbh dtd
 *                     int intyds inttd fgm fga xpm xpa fglong punts puntyds
 *   NHL skater        goals ast sog blk hit tk gv pm pim toi fow fol   | goalie  g=1 ga sa sv toi
 *   MLB hitter        ab h r rbi hr bb k                                | pitcher p=1 outs h r er bb k hr pit
 * plus the context keys the caller passes via `ctx` (won → `win`, postseason → `post`).
 */
import type { OtdSport } from './otdSnapshot';

/* ------------------------------ types ------------------------------ */

/** One regression term: contribution = w · f(Σ coef·stat), f = identity or hinge `max(0, x − t)`. */
export interface RatingTerm {
  n: string;
  e: Array<[stat: string, coef: number]>;
  f?: 'hinge';
  t?: number;
  w: number;
}
export type Cond = [stat: string, op: '>=' | '>' | '<=' | '<' | '==' | '!=', value: number];
export interface RaxFactor {
  reg: number;
  post: number;
}
export interface RatingGroup {
  id: string;
  label: string;
  /** Group matches when ANY clause (an AND of conditions) holds; no `when` = catch-all. First matching group wins. */
  when?: Cond[][];
  /** Rating is exactly 0 when all these stats are 0 (an empty stat line). */
  zeroIf?: string[];
  intercept: number;
  terms: RatingTerm[];
  min?: number;
  max?: number;
  n?: number;
  /** Real's CURRENT published rating→Rax factor for this group. */
  k: RaxFactor;
  /** Pitcher-style role factors; role comes from `roleRule` (or ctx.role). */
  kRole?: Record<string, RaxFactor>;
  roleRule?: { key: string; min: number; hi: string; lo: string };
  /** What Rateboard's STORED values used in older seasons (only applied with factors:'rateboard'). */
  kSeasons?: Array<RaxFactor & { from: number }>;
  kRoleSeasons?: Array<{ from: number } & Record<string, RaxFactor | number>>;
}
export interface SportModel {
  sport: string;
  trainSeasons: number[];
  testSeason: number;
  groups: RatingGroup[];
}
export interface ModelAccuracyTier {
  n: number;
  spearman: number | null;
  mape: number | null;
  biasPct: number | null;
  biasPctOfficialFactors?: number | null;
  overlap: number | null;
  /** Same model told each player's owner percentile (oracle for the low-owner uplift). */
  withOwners?: { spearman: number | null; mape: number | null; biasPct: number | null; overlap: number | null };
}
export interface ModelAccuracy {
  sport: string;
  trainSeasons: number[];
  testSeason: number;
  nTrain: number;
  /** Held-out game rows (test season). */
  n: number;
  r2Rating: number | null;
  maeRating: number | null;
  /** MAE of predicted vs Rateboard's actual per-game Rax (includes effects the model cannot see, e.g. low-owner uplift). */
  maeRax: number | null;
  /** MAE of predicted Rax vs round(k × ACTUAL rating): pure rating-prediction error. */
  maeRaxRatingOnly: number | null;
  exactRax: number | null;
  within1Rax: number | null;
  r2RatingPreDec2025: number | null;
  maeRaxPreDec2025: number | null;
  byGroup: Record<string, { n: number; r2: number | null; maeRating: number | null; maeRax: number | null; exact: number | null }>;
  /** Player-season (annual) totals: ESPN-only pipeline vs Rateboard's real totals. */
  annual?: {
    route: 'box' | 'gamelog';
    matched: number;
    /** Share of Rateboard's 150 biggest player-seasons the ESPN-only pipeline found and modeled (box route only). */
    coverageTop150?: number | null;
    spearmanAll: number | null;
    spearmanAllWithOwners?: number | null;
    top30?: ModelAccuracyTier;
    top50?: ModelAccuracyTier;
    top150?: ModelAccuracyTier;
  };
  /** Rank correlation of predicted vs Rateboard's actual player-season totals (top 150 by actual; top 30 for game-log sports). */
  spearmanSeasonTotal?: number | null;
  pipelinePerGame?: { n: number; exact: number | null; within1: number | null; maeRax: number | null; maeRating: number | null };
}

export interface RatingCtx {
  postseason?: boolean;
  won?: boolean;
  /** Force a group id (e.g. 'DEF'), skipping the stat-based selector. */
  group?: string;
  /** MLB pitcher role; default: ≥12 outs → 'SP', else 'RP'. */
  role?: string;
  season?: number;
  /** 'official' = Real's current published factors (default). 'rateboard' = factors Rateboard's stored values used per season. */
  factors?: 'official' | 'rateboard';
  /** Owner-count percentile of the player in his sport-season (optional): applies the empirical low-owner uplift. */
  ownersPercentile?: number | null;
}
export type StatRecord = Record<string, number | string | undefined | null>;

/* ------------------------------ GENERATED: coefficients (scripts/fit-rating-model.mjs) ------------------------------ */

// BEGIN GENERATED MODEL_DATA
export const MODEL_DATA: Record<string, SportModel> = {
 "NBA": {
  "sport": "NBA",
  "trainSeasons": [
   2024,
   2025
  ],
  "testSeason": 2026,
  "groups": [
   {
    "id": "all",
    "label": "All players",
    "zeroIf": [
     "pts",
     "reb",
     "ast",
     "stl",
     "blk",
     "tov",
     "pf",
     "fga",
     "fta"
    ],
    "intercept": 0,
    "terms": [
     {
      "n": "pts",
      "e": [
       [
        "pts",
        1
       ]
      ],
      "w": 0.10323
     },
     {
      "n": "reb",
      "e": [
       [
        "reb",
        1
       ]
      ],
      "w": 0.0857
     },
     {
      "n": "ast",
      "e": [
       [
        "ast",
        1
       ]
      ],
      "w": 0.16833
     },
     {
      "n": "stl",
      "e": [
       [
        "stl",
        1
       ]
      ],
      "w": 0.18337
     },
     {
      "n": "blk",
      "e": [
       [
        "blk",
        1
       ]
      ],
      "w": 0.18094
     },
     {
      "n": "tov",
      "e": [
       [
        "tov",
        1
       ]
      ],
      "w": -0.1862
     },
     {
      "n": "pf",
      "e": [
       [
        "pf",
        1
       ]
      ],
      "w": 0.00336
     },
     {
      "n": "fgm",
      "e": [
       [
        "fgm",
        1
       ]
      ],
      "w": 0.03249
     },
     {
      "n": "fgmiss",
      "e": [
       [
        "fga",
        1
       ],
       [
        "fgm",
        -1
       ]
      ],
      "w": -0.04665
     },
     {
      "n": "tpm",
      "e": [
       [
        "tpm",
        1
       ]
      ],
      "w": 0.05768
     },
     {
      "n": "tpmiss",
      "e": [
       [
        "tpa",
        1
       ],
       [
        "tpm",
        -1
       ]
      ],
      "w": -0.00075
     },
     {
      "n": "ftmiss",
      "e": [
       [
        "fta",
        1
       ],
       [
        "ftm",
        -1
       ]
      ],
      "w": 0.00138
     },
     {
      "n": "ftm",
      "e": [
       [
        "ftm",
        1
       ]
      ],
      "w": -0.01942
     },
     {
      "n": "win",
      "e": [
       [
        "win",
        1
       ]
      ],
      "w": 0.08201
     },
     {
      "n": "pts>20",
      "e": [
       [
        "pts",
        1
       ]
      ],
      "f": "hinge",
      "t": 20,
      "w": 0.03432
     }
    ],
    "min": -0.61,
    "max": 17.43,
    "n": 16595,
    "k": {
     "reg": 1,
     "post": 2
    }
   }
  ]
 },
 "WNBA": {
  "sport": "WNBA",
  "trainSeasons": [
   2024
  ],
  "testSeason": 2025,
  "groups": [
   {
    "id": "all",
    "label": "All players",
    "zeroIf": [
     "pts",
     "reb",
     "ast",
     "stl",
     "blk",
     "tov",
     "pf",
     "fga",
     "fta"
    ],
    "intercept": 0,
    "terms": [
     {
      "n": "pts",
      "e": [
       [
        "pts",
        1
       ]
      ],
      "w": 0.12307
     },
     {
      "n": "reb",
      "e": [
       [
        "reb",
        1
       ]
      ],
      "w": 0.09966
     },
     {
      "n": "ast",
      "e": [
       [
        "ast",
        1
       ]
      ],
      "w": 0.18885
     },
     {
      "n": "stl",
      "e": [
       [
        "stl",
        1
       ]
      ],
      "w": 0.222
     },
     {
      "n": "blk",
      "e": [
       [
        "blk",
        1
       ]
      ],
      "w": 0.22037
     },
     {
      "n": "tov",
      "e": [
       [
        "tov",
        1
       ]
      ],
      "w": -0.2195
     },
     {
      "n": "pf",
      "e": [
       [
        "pf",
        1
       ]
      ],
      "w": -0.00017
     },
     {
      "n": "fgm",
      "e": [
       [
        "fgm",
        1
       ]
      ],
      "w": 0.03565
     },
     {
      "n": "fgmiss",
      "e": [
       [
        "fga",
        1
       ],
       [
        "fgm",
        -1
       ]
      ],
      "w": -0.03878
     },
     {
      "n": "tpm",
      "e": [
       [
        "tpm",
        1
       ]
      ],
      "w": 0.06365
     },
     {
      "n": "tpmiss",
      "e": [
       [
        "tpa",
        1
       ],
       [
        "tpm",
        -1
       ]
      ],
      "w": -0.00551
     },
     {
      "n": "ftmiss",
      "e": [
       [
        "fta",
        1
       ],
       [
        "ftm",
        -1
       ]
      ],
      "w": -0.00652
     },
     {
      "n": "ftm",
      "e": [
       [
        "ftm",
        1
       ]
      ],
      "w": -0.01188
     },
     {
      "n": "win",
      "e": [
       [
        "win",
        1
       ]
      ],
      "w": 0.06856
     },
     {
      "n": "pts>20",
      "e": [
       [
        "pts",
        1
       ]
      ],
      "f": "hinge",
      "t": 20,
      "w": 0.03713
     }
    ],
    "min": -0.52,
    "max": 12.01,
    "n": 4812,
    "k": {
     "reg": 2,
     "post": 4
    }
   }
  ]
 },
 "CBB": {
  "sport": "CBB",
  "trainSeasons": [
   2024,
   2025
  ],
  "testSeason": 2026,
  "groups": [
   {
    "id": "all",
    "label": "All players",
    "zeroIf": [
     "pts",
     "reb",
     "ast",
     "stl",
     "blk",
     "tov",
     "pf",
     "fga",
     "fta"
    ],
    "intercept": 0,
    "terms": [
     {
      "n": "pts",
      "e": [
       [
        "pts",
        1
       ]
      ],
      "w": 0.14016
     },
     {
      "n": "reb",
      "e": [
       [
        "reb",
        1
       ]
      ],
      "w": 0.1145
     },
     {
      "n": "ast",
      "e": [
       [
        "ast",
        1
       ]
      ],
      "w": 0.23636
     },
     {
      "n": "stl",
      "e": [
       [
        "stl",
        1
       ]
      ],
      "w": 0.2485
     },
     {
      "n": "blk",
      "e": [
       [
        "blk",
        1
       ]
      ],
      "w": 0.31096
     },
     {
      "n": "tov",
      "e": [
       [
        "tov",
        1
       ]
      ],
      "w": -0.25717
     },
     {
      "n": "pf",
      "e": [
       [
        "pf",
        1
       ]
      ],
      "w": -0.00086
     },
     {
      "n": "fgm",
      "e": [
       [
        "fgm",
        1
       ]
      ],
      "w": 0.04502
     },
     {
      "n": "fgmiss",
      "e": [
       [
        "fga",
        1
       ],
       [
        "fgm",
        -1
       ]
      ],
      "w": -0.04612
     },
     {
      "n": "tpm",
      "e": [
       [
        "tpm",
        1
       ]
      ],
      "w": 0.06037
     },
     {
      "n": "tpmiss",
      "e": [
       [
        "tpa",
        1
       ],
       [
        "tpm",
        -1
       ]
      ],
      "w": -0.00281
     },
     {
      "n": "ftmiss",
      "e": [
       [
        "fta",
        1
       ],
       [
        "ftm",
        -1
       ]
      ],
      "w": 0.00297
     },
     {
      "n": "ftm",
      "e": [
       [
        "ftm",
        1
       ]
      ],
      "w": -0.01025
     },
     {
      "n": "win",
      "e": [
       [
        "win",
        1
       ]
      ],
      "w": 0.07445
     },
     {
      "n": "pts>20",
      "e": [
       [
        "pts",
        1
       ]
      ],
      "f": "hinge",
      "t": 20,
      "w": 0.06855
     }
    ],
    "min": -1.13,
    "max": 13.82,
    "n": 30464,
    "k": {
     "reg": 2.5,
     "post": 5
    }
   }
  ]
 },
 "NFL": {
  "sport": "NFL",
  "trainSeasons": [
   2023,
   2024
  ],
  "testSeason": 2025,
  "groups": [
   {
    "id": "QB",
    "label": "Quarterback",
    "when": [
     [
      [
       "patt",
       ">=",
       3
      ]
     ]
    ],
    "intercept": -0.18005,
    "terms": [
     {
      "n": "pcmp",
      "e": [
       [
        "pcmp",
        1
       ]
      ],
      "w": -0.01567
     },
     {
      "n": "pinc",
      "e": [
       [
        "patt",
        1
       ],
       [
        "pcmp",
        -1
       ]
      ],
      "w": -0.01542
     },
     {
      "n": "pyds",
      "e": [
       [
        "pyds",
        1
       ]
      ],
      "w": 0.01296
     },
     {
      "n": "ptd",
      "e": [
       [
        "ptd",
        1
       ]
      ],
      "w": 0.57932
     },
     {
      "n": "pint",
      "e": [
       [
        "pint",
        1
       ]
      ],
      "w": -0.66676
     },
     {
      "n": "sacked",
      "e": [
       [
        "sacked",
        1
       ]
      ],
      "w": 0.01756
     },
     {
      "n": "ratt",
      "e": [
       [
        "ratt",
        1
       ]
      ],
      "w": -0.00304
     },
     {
      "n": "ryds",
      "e": [
       [
        "ryds",
        1
       ]
      ],
      "w": 0.01223
     },
     {
      "n": "rtd",
      "e": [
       [
        "rtd",
        1
       ]
      ],
      "w": 0.66714
     },
     {
      "n": "fuml",
      "e": [
       [
        "fuml",
        1
       ]
      ],
      "w": -0.37352
     },
     {
      "n": "win",
      "e": [
       [
        "win",
        1
       ]
      ],
      "w": 0.23021
     }
    ],
    "min": -1.21,
    "max": 11.44,
    "n": 430,
    "k": {
     "reg": 5,
     "post": 10
    }
   },
   {
    "id": "K",
    "label": "Kicker",
    "when": [
     [
      [
       "fga",
       ">=",
       1
      ]
     ],
     [
      [
       "xpa",
       ">=",
       1
      ]
     ]
    ],
    "intercept": -0.14458,
    "terms": [
     {
      "n": "fgm",
      "e": [
       [
        "fgm",
        1
       ]
      ],
      "w": 1.17863
     },
     {
      "n": "fgmiss",
      "e": [
       [
        "fga",
        1
       ],
       [
        "fgm",
        -1
       ]
      ],
      "w": -1.18797
     },
     {
      "n": "xpm",
      "e": [
       [
        "xpm",
        1
       ]
      ],
      "w": 0.25736
     },
     {
      "n": "xpmiss",
      "e": [
       [
        "xpa",
        1
       ],
       [
        "xpm",
        -1
       ]
      ],
      "w": -0.45784
     },
     {
      "n": "fglong",
      "e": [
       [
        "fglong",
        1
       ]
      ],
      "w": 0.00683
     },
     {
      "n": "win",
      "e": [
       [
        "win",
        1
       ]
      ],
      "w": 0.24658
     }
    ],
    "min": -2.27,
    "max": 10.56,
    "n": 388,
    "k": {
     "reg": 5,
     "post": 10
    }
   },
   {
    "id": "P",
    "label": "Punter",
    "when": [
     [
      [
       "punts",
       ">=",
       1
      ]
     ]
    ],
    "intercept": -0.01411,
    "terms": [
     {
      "n": "punts",
      "e": [
       [
        "punts",
        1
       ]
      ],
      "w": -0.02119
     },
     {
      "n": "puntyds",
      "e": [
       [
        "puntyds",
        1
       ]
      ],
      "w": 0.00797
     },
     {
      "n": "win",
      "e": [
       [
        "win",
        1
       ]
      ],
      "w": 0.06714
     }
    ],
    "min": 0.23,
    "max": 4.34,
    "n": 381,
    "k": {
     "reg": 7,
     "post": 14
    },
    "kSeasons": [
     {
      "from": 0,
      "reg": 5,
      "post": 10
     },
     {
      "from": 2025,
      "reg": 7,
      "post": 14
     }
    ]
   },
   {
    "id": "SKILL",
    "label": "Rusher / receiver",
    "when": [
     [
      [
       "ratt",
       ">=",
       1
      ]
     ],
     [
      [
       "rec",
       ">=",
       1
      ]
     ],
     [
      [
       "tgt",
       ">=",
       1
      ]
     ]
    ],
    "intercept": -0.03127,
    "terms": [
     {
      "n": "ratt",
      "e": [
       [
        "ratt",
        1
       ]
      ],
      "w": 0.00356
     },
     {
      "n": "ryds",
      "e": [
       [
        "ryds",
        1
       ]
      ],
      "w": 0.03346
     },
     {
      "n": "rtd",
      "e": [
       [
        "rtd",
        1
       ]
      ],
      "w": 0.88044
     },
     {
      "n": "rec",
      "e": [
       [
        "rec",
        1
       ]
      ],
      "w": -0.0094
     },
     {
      "n": "recyds",
      "e": [
       [
        "recyds",
        1
       ]
      ],
      "w": 0.03442
     },
     {
      "n": "rectd",
      "e": [
       [
        "rectd",
        1
       ]
      ],
      "w": 0.90894
     },
     {
      "n": "tgtmiss",
      "e": [
       [
        "tgt",
        1
       ],
       [
        "rec",
        -1
       ]
      ],
      "w": 0.00137
     },
     {
      "n": "fuml",
      "e": [
       [
        "fuml",
        1
       ]
      ],
      "w": -0.5852
     },
     {
      "n": "win",
      "e": [
       [
        "win",
        1
       ]
      ],
      "w": 0.08198
     },
     {
      "n": "ryds>100",
      "e": [
       [
        "ryds",
        1
       ]
      ],
      "f": "hinge",
      "t": 100,
      "w": 0.00225
     }
    ],
    "min": -0.45,
    "max": 15.28,
    "n": 3392,
    "k": {
     "reg": 5,
     "post": 10
    }
   },
   {
    "id": "DEF",
    "label": "Defender / other",
    "intercept": -0.05234,
    "terms": [
     {
      "n": "solo",
      "e": [
       [
        "solo",
        1
       ]
      ],
      "w": 0.20703
     },
     {
      "n": "ast",
      "e": [
       [
        "tkl",
        1
       ],
       [
        "solo",
        -1
       ]
      ],
      "w": 0.02379
     },
     {
      "n": "sacks",
      "e": [
       [
        "sacks",
        1
       ]
      ],
      "w": 0.87134
     },
     {
      "n": "tfl",
      "e": [
       [
        "tfl",
        1
       ]
      ],
      "w": 0.30676
     },
     {
      "n": "pd",
      "e": [
       [
        "pd",
        1
       ]
      ],
      "w": 0.3713
     },
     {
      "n": "qbh",
      "e": [
       [
        "qbh",
        1
       ]
      ],
      "w": 0.04391
     },
     {
      "n": "int",
      "e": [
       [
        "int",
        1
       ]
      ],
      "w": 2.05758
     },
     {
      "n": "intyds",
      "e": [
       [
        "intyds",
        1
       ]
      ],
      "w": 0.00813
     },
     {
      "n": "inttd",
      "e": [
       [
        "inttd",
        1
       ]
      ],
      "w": -0.90536
     },
     {
      "n": "dtd",
      "e": [
       [
        "dtd",
        1
       ]
      ],
      "w": 2.19973
     },
     {
      "n": "fumrec",
      "e": [
       [
        "fumrec",
        1
       ]
      ],
      "w": 1.86554
     },
     {
      "n": "win",
      "e": [
       [
        "win",
        1
       ]
      ],
      "w": 0.03139
     },
     {
      "n": "sacks>2",
      "e": [
       [
        "sacks",
        1
       ]
      ],
      "f": "hinge",
      "t": 2,
      "w": 0.43365
     }
    ],
    "min": -0.63,
    "max": 12.91,
    "n": 7154,
    "k": {
     "reg": 7,
     "post": 14
    },
    "kSeasons": [
     {
      "from": 0,
      "reg": 5,
      "post": 10
     },
     {
      "from": 2025,
      "reg": 7,
      "post": 14
     }
    ]
   }
  ]
 },
 "CFB": {
  "sport": "CFB",
  "trainSeasons": [
   2023,
   2024
  ],
  "testSeason": 2025,
  "groups": [
   {
    "id": "QB",
    "label": "Quarterback",
    "when": [
     [
      [
       "patt",
       ">=",
       3
      ]
     ]
    ],
    "intercept": -0.0922,
    "terms": [
     {
      "n": "pcmp",
      "e": [
       [
        "pcmp",
        1
       ]
      ],
      "w": -0.01938
     },
     {
      "n": "pinc",
      "e": [
       [
        "patt",
        1
       ],
       [
        "pcmp",
        -1
       ]
      ],
      "w": -0.0337
     },
     {
      "n": "pyds",
      "e": [
       [
        "pyds",
        1
       ]
      ],
      "w": 0.01421
     },
     {
      "n": "ptd",
      "e": [
       [
        "ptd",
        1
       ]
      ],
      "w": 0.55364
     },
     {
      "n": "pint",
      "e": [
       [
        "pint",
        1
       ]
      ],
      "w": -0.72133
     },
     {
      "n": "sacked",
      "e": [
       [
        "sacked",
        1
       ]
      ],
      "w": 0
     },
     {
      "n": "ratt",
      "e": [
       [
        "ratt",
        1
       ]
      ],
      "w": 0.02545
     },
     {
      "n": "ryds",
      "e": [
       [
        "ryds",
        1
       ]
      ],
      "w": 0.00831
     },
     {
      "n": "rtd",
      "e": [
       [
        "rtd",
        1
       ]
      ],
      "w": 0.58589
     },
     {
      "n": "fuml",
      "e": [
       [
        "fuml",
        1
       ]
      ],
      "w": -0.14407
     },
     {
      "n": "win",
      "e": [
       [
        "win",
        1
       ]
      ],
      "w": 0.22162
     }
    ],
    "min": -1.32,
    "max": 9.29,
    "n": 140,
    "k": {
     "reg": 5,
     "post": 10
    }
   },
   {
    "id": "K",
    "label": "Kicker",
    "when": [
     [
      [
       "fga",
       ">=",
       1
      ]
     ],
     [
      [
       "xpa",
       ">=",
       1
      ]
     ]
    ],
    "intercept": -0.02795,
    "terms": [
     {
      "n": "fgm",
      "e": [
       [
        "fgm",
        1
       ]
      ],
      "w": 1.16859
     },
     {
      "n": "fgmiss",
      "e": [
       [
        "fga",
        1
       ],
       [
        "fgm",
        -1
       ]
      ],
      "w": -1.12396
     },
     {
      "n": "xpm",
      "e": [
       [
        "xpm",
        1
       ]
      ],
      "w": 0.2646
     },
     {
      "n": "xpmiss",
      "e": [
       [
        "xpa",
        1
       ],
       [
        "xpm",
        -1
       ]
      ],
      "w": -0.41235
     },
     {
      "n": "fglong",
      "e": [
       [
        "fglong",
        1
       ]
      ],
      "w": 0.005
     },
     {
      "n": "win",
      "e": [
       [
        "win",
        1
       ]
      ],
      "w": 0.12708
     }
    ],
    "min": -2.71,
    "max": 8.66,
    "n": 107,
    "k": {
     "reg": 5,
     "post": 10
    }
   },
   {
    "id": "P",
    "label": "Punter",
    "when": [
     [
      [
       "punts",
       ">=",
       1
      ]
     ]
    ],
    "intercept": -0.00885,
    "terms": [
     {
      "n": "punts",
      "e": [
       [
        "punts",
        1
       ]
      ],
      "w": -0.02246
     },
     {
      "n": "puntyds",
      "e": [
       [
        "puntyds",
        1
       ]
      ],
      "w": 0.0079
     },
     {
      "n": "win",
      "e": [
       [
        "win",
        1
       ]
      ],
      "w": 0.08579
     }
    ],
    "min": 0.24,
    "max": 3.92,
    "n": 109,
    "k": {
     "reg": 8,
     "post": 16
    }
   },
   {
    "id": "SKILL",
    "label": "Rusher / receiver",
    "when": [
     [
      [
       "ratt",
       ">=",
       1
      ]
     ],
     [
      [
       "rec",
       ">=",
       1
      ]
     ],
     [
      [
       "tgt",
       ">=",
       1
      ]
     ]
    ],
    "intercept": -0.08106,
    "terms": [
     {
      "n": "ratt",
      "e": [
       [
        "ratt",
        1
       ]
      ],
      "w": 0.00375
     },
     {
      "n": "ryds",
      "e": [
       [
        "ryds",
        1
       ]
      ],
      "w": 0.03416
     },
     {
      "n": "rtd",
      "e": [
       [
        "rtd",
        1
       ]
      ],
      "w": 0.84109
     },
     {
      "n": "rec",
      "e": [
       [
        "rec",
        1
       ]
      ],
      "w": 0.00406
     },
     {
      "n": "recyds",
      "e": [
       [
        "recyds",
        1
       ]
      ],
      "w": 0.03433
     },
     {
      "n": "rectd",
      "e": [
       [
        "rectd",
        1
       ]
      ],
      "w": 0.83622
     },
     {
      "n": "tgtmiss",
      "e": [
       [
        "tgt",
        1
       ],
       [
        "rec",
        -1
       ]
      ],
      "w": -0.00406
     },
     {
      "n": "fuml",
      "e": [
       [
        "fuml",
        1
       ]
      ],
      "w": -0.41801
     },
     {
      "n": "win",
      "e": [
       [
        "win",
        1
       ]
      ],
      "w": 0.12989
     }
    ],
    "min": -0.35,
    "max": 16.32,
    "n": 971,
    "k": {
     "reg": 5,
     "post": 10
    }
   },
   {
    "id": "DEF",
    "label": "Defender / other",
    "intercept": 0.0757,
    "terms": [
     {
      "n": "solo",
      "e": [
       [
        "solo",
        1
       ]
      ],
      "w": 0.16798
     },
     {
      "n": "ast",
      "e": [
       [
        "tkl",
        1
       ],
       [
        "solo",
        -1
       ]
      ],
      "w": 0.08214
     },
     {
      "n": "sacks",
      "e": [
       [
        "sacks",
        1
       ]
      ],
      "w": 0.81512
     },
     {
      "n": "tfl",
      "e": [
       [
        "tfl",
        1
       ]
      ],
      "w": 0.25066
     },
     {
      "n": "pd",
      "e": [
       [
        "pd",
        1
       ]
      ],
      "w": 0.34293
     },
     {
      "n": "qbh",
      "e": [
       [
        "qbh",
        1
       ]
      ],
      "w": 0.02745
     },
     {
      "n": "int",
      "e": [
       [
        "int",
        1
       ]
      ],
      "w": 2.66358
     },
     {
      "n": "intyds",
      "e": [
       [
        "intyds",
        1
       ]
      ],
      "w": 0.00295
     },
     {
      "n": "inttd",
      "e": [
       [
        "inttd",
        1
       ]
      ],
      "w": -0.3672
     },
     {
      "n": "dtd",
      "e": [
       [
        "dtd",
        1
       ]
      ],
      "w": 1.8207
     },
     {
      "n": "fumrec",
      "e": [
       [
        "fumrec",
        1
       ]
      ],
      "w": 2.03433
     },
     {
      "n": "win",
      "e": [
       [
        "win",
        1
       ]
      ],
      "w": -0.16935
     }
    ],
    "min": -0.23,
    "max": 8.73,
    "n": 1652,
    "k": {
     "reg": 8,
     "post": 16
    }
   }
  ]
 },
 "NHL": {
  "sport": "NHL",
  "trainSeasons": [
   2023,
   2024
  ],
  "testSeason": 2025,
  "groups": [
   {
    "id": "G",
    "label": "Goalie",
    "when": [
     [
      [
       "g",
       ">=",
       1
      ]
     ]
    ],
    "intercept": -0.01213,
    "terms": [
     {
      "n": "ga",
      "e": [
       [
        "ga",
        1
       ]
      ],
      "w": -1.66429
     },
     {
      "n": "sv",
      "e": [
       [
        "sv",
        1
       ]
      ],
      "w": 0.19255
     },
     {
      "n": "win",
      "e": [
       [
        "win",
        1
       ]
      ],
      "w": 0.15726
     },
     {
      "n": "toi",
      "e": [
       [
        "toi",
        1
       ]
      ],
      "w": -0.00348
     }
    ],
    "min": -6,
    "max": 8.39,
    "n": 360,
    "k": {
     "reg": 3,
     "post": 6
    }
   },
   {
    "id": "S",
    "label": "Skater",
    "intercept": -0.06158,
    "terms": [
     {
      "n": "goals",
      "e": [
       [
        "goals",
        1
       ]
      ],
      "w": 2.25512
     },
     {
      "n": "ast",
      "e": [
       [
        "ast",
        1
       ]
      ],
      "w": 1.23368
     },
     {
      "n": "sog",
      "e": [
       [
        "sog",
        1
       ]
      ],
      "w": 0.16627
     },
     {
      "n": "blk",
      "e": [
       [
        "blk",
        1
       ]
      ],
      "w": 0.30791
     },
     {
      "n": "hit",
      "e": [
       [
        "hit",
        1
       ]
      ],
      "w": 0.15534
     },
     {
      "n": "tk",
      "e": [
       [
        "tk",
        1
       ]
      ],
      "w": 0.08047
     },
     {
      "n": "gv",
      "e": [
       [
        "gv",
        1
       ]
      ],
      "w": -0.07896
     },
     {
      "n": "pm",
      "e": [
       [
        "pm",
        1
       ]
      ],
      "w": 0.01065
     },
     {
      "n": "pim",
      "e": [
       [
        "pim",
        1
       ]
      ],
      "w": 0.00034
     },
     {
      "n": "win",
      "e": [
       [
        "win",
        1
       ]
      ],
      "w": 0.05138
     },
     {
      "n": "toi",
      "e": [
       [
        "toi",
        1
       ]
      ],
      "w": 0.00599
     },
     {
      "n": "fow",
      "e": [
       [
        "fow",
        1
       ]
      ],
      "w": 0.06917
     },
     {
      "n": "fol",
      "e": [
       [
        "fol",
        1
       ]
      ],
      "w": 0.00034
     }
    ],
    "min": -0.27,
    "max": 13.5,
    "n": 6212,
    "k": {
     "reg": 1.2,
     "post": 2.4
    }
   }
  ]
 },
 "MLB": {
  "sport": "MLB",
  "trainSeasons": [
   2023,
   2024
  ],
  "testSeason": 2025,
  "groups": [
   {
    "id": "P",
    "label": "Pitcher",
    "when": [
     [
      [
       "p",
       ">=",
       1
      ]
     ]
    ],
    "intercept": 0.00519,
    "terms": [
     {
      "n": "outs",
      "e": [
       [
        "outs",
        1
       ]
      ],
      "w": 0.38378
     },
     {
      "n": "h",
      "e": [
       [
        "h",
        1
       ]
      ],
      "w": -0.3209
     },
     {
      "n": "r",
      "e": [
       [
        "r",
        1
       ]
      ],
      "w": 0.08806
     },
     {
      "n": "er",
      "e": [
       [
        "er",
        1
       ]
      ],
      "w": -0.45891
     },
     {
      "n": "bb",
      "e": [
       [
        "bb",
        1
       ]
      ],
      "w": -0.22225
     },
     {
      "n": "k",
      "e": [
       [
        "k",
        1
       ]
      ],
      "w": 0.15069
     },
     {
      "n": "hr",
      "e": [
       [
        "hr",
        1
       ]
      ],
      "w": -0.76462
     },
     {
      "n": "pit",
      "e": [
       [
        "pit",
        1
       ]
      ],
      "w": -0.01143
     },
     {
      "n": "win",
      "e": [
       [
        "win",
        1
       ]
      ],
      "w": -0.0027
     }
    ],
    "min": -6,
    "max": 12.58,
    "n": 2607,
    "k": {
     "reg": 3,
     "post": 6
    },
    "kSeasons": [
     {
      "from": 2025,
      "reg": 2,
      "post": 4
     }
    ],
    "kRole": {
     "SP": {
      "reg": 3,
      "post": 6
     },
     "RP": {
      "reg": 5,
      "post": 10
     }
    },
    "kRoleSeasons": [
     {
      "from": 2025,
      "SP": {
       "reg": 2,
       "post": 4
      },
      "RP": {
       "reg": 4,
       "post": 8
      }
     }
    ],
    "roleRule": {
     "key": "outs",
     "min": 12,
     "hi": "SP",
     "lo": "RP"
    }
   },
   {
    "id": "H",
    "label": "Hitter",
    "intercept": 0.03125,
    "terms": [
     {
      "n": "abOut",
      "e": [
       [
        "ab",
        1
       ],
       [
        "h",
        -1
       ]
      ],
      "w": -0.16607
     },
     {
      "n": "h",
      "e": [
       [
        "h",
        1
       ]
      ],
      "w": 0.55956
     },
     {
      "n": "r",
      "e": [
       [
        "r",
        1
       ]
      ],
      "w": 0.33956
     },
     {
      "n": "rbi",
      "e": [
       [
        "rbi",
        1
       ]
      ],
      "w": 0.87884
     },
     {
      "n": "hr",
      "e": [
       [
        "hr",
        1
       ]
      ],
      "w": 0.39042
     },
     {
      "n": "bb",
      "e": [
       [
        "bb",
        1
       ]
      ],
      "w": 0.13639
     },
     {
      "n": "k",
      "e": [
       [
        "k",
        1
       ]
      ],
      "w": 0.01092
     },
     {
      "n": "win",
      "e": [
       [
        "win",
        1
       ]
      ],
      "w": 0.00342
     },
     {
      "n": "h>3",
      "e": [
       [
        "h",
        1
       ]
      ],
      "f": "hinge",
      "t": 3,
      "w": 0.54583
     }
    ],
    "min": -1.16,
    "max": 13.98,
    "n": 6146,
    "k": {
     "reg": 2,
     "post": 4
    },
    "kSeasons": [
     {
      "from": 2025,
      "reg": 1.5,
      "post": 3
     }
    ]
   }
  ]
 }
};
// END GENERATED MODEL_DATA

// BEGIN GENERATED MODEL_ACCURACY
export const MODEL_ACCURACY: Record<string, ModelAccuracy> = {
 "NBA": {
  "sport": "NBA",
  "trainSeasons": [
   2024,
   2025
  ],
  "testSeason": 2026,
  "nTrain": 27041,
  "n": 8250,
  "r2Rating": 0.9699,
  "maeRating": 0.1738,
  "maeRax": 0.38,
  "maeRaxRatingOnly": 0.191,
  "exactRax": 0.66,
  "within1Rax": 0.965,
  "r2RatingPreDec2025": 0.9735,
  "maeRaxPreDec2025": 0.181,
  "byGroup": {
   "all": {
    "n": 8250,
    "r2": 0.9699,
    "maeRating": 0.1738,
    "maeRax": 0.38,
    "exact": 0.66
   }
  },
  "annual": {
   "route": "gamelog",
   "matched": 50,
   "coverageTop150": null,
   "spearmanAll": 0.985,
   "spearmanAllWithOwners": 0.986,
   "top30": {
    "n": 30,
    "spearman": 0.951,
    "mape": 0.032,
    "biasPct": 0.001,
    "overlap": 0.967,
    "withOwners": {
     "spearman": 0.943,
     "mape": 0.029,
     "biasPct": 0.006,
     "overlap": 1
    }
   }
  },
  "pipelinePerGame": {
   "n": 3837,
   "exact": 0.675,
   "within1": 0.977,
   "maeRax": 0.355,
   "maeRating": 0.241
  },
  "spearmanSeasonTotal": 0.951
 },
 "WNBA": {
  "sport": "WNBA",
  "trainSeasons": [
   2024
  ],
  "testSeason": 2025,
  "nTrain": 6141,
  "n": 5671,
  "r2Rating": 0.9706,
  "maeRating": 0.173,
  "maeRax": 0.946,
  "maeRaxRatingOnly": 0.357,
  "exactRax": 0.399,
  "within1Rax": 0.784,
  "r2RatingPreDec2025": 0.9706,
  "maeRaxPreDec2025": 0.946,
  "byGroup": {
   "all": {
    "n": 5671,
    "r2": 0.9706,
    "maeRating": 0.173,
    "maeRax": 0.946,
    "exact": 0.399
   }
  },
  "annual": {
   "route": "gamelog",
   "matched": 45,
   "coverageTop150": null,
   "spearmanAll": 0.974,
   "spearmanAllWithOwners": 0.949,
   "top30": {
    "n": 30,
    "spearman": 0.925,
    "mape": 0.075,
    "biasPct": -0.066,
    "overlap": 0.967,
    "withOwners": {
     "spearman": 0.846,
     "mape": 0.077,
     "biasPct": 0.033,
     "overlap": 0.933
    }
   }
  },
  "pipelinePerGame": {
   "n": 1861,
   "exact": 0.442,
   "within1": 0.84,
   "maeRax": 0.808,
   "maeRating": 0.219
  },
  "spearmanSeasonTotal": 0.925
 },
 "CBB": {
  "sport": "CBB",
  "trainSeasons": [
   2024,
   2025
  ],
  "testSeason": 2026,
  "nTrain": 39554,
  "n": 15405,
  "r2Rating": 0.9675,
  "maeRating": 0.1916,
  "maeRax": 1.206,
  "maeRaxRatingOnly": 0.495,
  "exactRax": 0.365,
  "within1Rax": 0.705,
  "r2RatingPreDec2025": 0.9676,
  "maeRaxPreDec2025": 0.603,
  "byGroup": {
   "all": {
    "n": 15405,
    "r2": 0.9675,
    "maeRating": 0.1916,
    "maeRax": 1.206,
    "exact": 0.365
   }
  }
 },
 "NFL": {
  "sport": "NFL",
  "trainSeasons": [
   2023,
   2024
  ],
  "testSeason": 2025,
  "nTrain": 11745,
  "n": 5413,
  "r2Rating": 0.9472,
  "maeRating": 0.1559,
  "maeRax": 1.495,
  "maeRaxRatingOnly": 0.97,
  "exactRax": 0.409,
  "within1Rax": 0.729,
  "r2RatingPreDec2025": 0.9468,
  "maeRaxPreDec2025": 0.972,
  "byGroup": {
   "DEF": {
    "n": 3133,
    "r2": 0.8931,
    "maeRating": 0.1775,
    "maeRax": 1.81,
    "exact": 0.327
   },
   "SKILL": {
    "n": 1670,
    "r2": 0.9795,
    "maeRating": 0.0864,
    "maeRax": 0.875,
    "exact": 0.592
   },
   "QB": {
    "n": 220,
    "r2": 0.9582,
    "maeRating": 0.2486,
    "maeRax": 1.236,
    "exact": 0.327
   },
   "K": {
    "n": 195,
    "r2": 0.9122,
    "maeRating": 0.3793,
    "maeRax": 1.949,
    "exact": 0.195
   },
   "P": {
    "n": 195,
    "r2": 0.9667,
    "maeRating": 0.0745,
    "maeRax": 1.585,
    "exact": 0.477
   }
  },
  "annual": {
   "route": "box",
   "matched": 1551,
   "coverageTop150": 0.993,
   "spearmanAll": 0.987,
   "spearmanAllWithOwners": 0.985,
   "top50": {
    "n": 50,
    "spearman": 0.965,
    "mape": 0.034,
    "biasPct": -0.025,
    "biasPctOfficialFactors": -0.025,
    "overlap": 0.88,
    "withOwners": {
     "spearman": 0.9,
     "mape": 0.036,
     "biasPct": -0.001,
     "overlap": 0.88
    }
   },
   "top150": {
    "n": 150,
    "spearman": 0.917,
    "mape": 0.05,
    "biasPct": -0.036,
    "biasPctOfficialFactors": -0.036,
    "overlap": 0.927,
    "withOwners": {
     "spearman": 0.877,
     "mape": 0.055,
     "biasPct": 0.01,
     "overlap": 0.92
    }
   }
  },
  "spearmanSeasonTotal": 0.917
 },
 "CFB": {
  "sport": "CFB",
  "trainSeasons": [
   2023,
   2024
  ],
  "testSeason": 2025,
  "nTrain": 2979,
  "n": 1938,
  "r2Rating": 0.8958,
  "maeRating": 0.2272,
  "maeRax": 3.009,
  "maeRaxRatingOnly": 1.957,
  "exactRax": 0.227,
  "within1Rax": 0.517,
  "r2RatingPreDec2025": 0.9029,
  "maeRaxPreDec2025": 2.902,
  "byGroup": {
   "DEF": {
    "n": 1149,
    "r2": 0.806,
    "maeRating": 0.2696,
    "maeRax": 3.836,
    "exact": 0.096
   },
   "SKILL": {
    "n": 582,
    "r2": 0.9162,
    "maeRating": 0.1602,
    "maeRax": 1.686,
    "exact": 0.452
   },
   "QB": {
    "n": 81,
    "r2": 0.972,
    "maeRating": 0.2284,
    "maeRax": 1.852,
    "exact": 0.358
   },
   "K": {
    "n": 64,
    "r2": 0.9753,
    "maeRating": 0.1809,
    "maeRax": 1.656,
    "exact": 0.344
   },
   "P": {
    "n": 62,
    "r2": 0.92,
    "maeRating": 0.1158,
    "maeRax": 3.016,
    "exact": 0.242
   }
  },
  "annual": {
   "route": "box",
   "matched": 7045,
   "coverageTop150": 0.953,
   "spearmanAll": 0.965,
   "spearmanAllWithOwners": 0.962,
   "top50": {
    "n": 50,
    "spearman": 0.543,
    "mape": 0.169,
    "biasPct": -0.163,
    "biasPctOfficialFactors": -0.163,
    "overlap": 0.6,
    "withOwners": {
     "spearman": 0.54,
     "mape": 0.122,
     "biasPct": -0.112,
     "overlap": 0.72
    }
   },
   "top150": {
    "n": 150,
    "spearman": 0.548,
    "mape": 0.201,
    "biasPct": -0.195,
    "biasPctOfficialFactors": -0.195,
    "overlap": 0.633,
    "withOwners": {
     "spearman": 0.592,
     "mape": 0.126,
     "biasPct": -0.117,
     "overlap": 0.68
    }
   }
  },
  "spearmanSeasonTotal": 0.548
 },
 "NHL": {
  "sport": "NHL",
  "trainSeasons": [
   2023,
   2024
  ],
  "testSeason": 2025,
  "nTrain": 6572,
  "n": 3010,
  "r2Rating": 0.985,
  "maeRating": 0.1162,
  "maeRax": 0.396,
  "maeRaxRatingOnly": 0.147,
  "exactRax": 0.674,
  "within1Rax": 0.947,
  "r2RatingPreDec2025": 0.9819,
  "maeRaxPreDec2025": 0.175,
  "byGroup": {
   "S": {
    "n": 2847,
    "r2": 0.9829,
    "maeRating": 0.1101,
    "maeRax": 0.382,
    "exact": 0.68
   },
   "G": {
    "n": 163,
    "r2": 0.9881,
    "maeRating": 0.2222,
    "maeRax": 0.632,
    "exact": 0.577
   }
  },
  "annual": {
   "route": "box",
   "matched": 1005,
   "coverageTop150": 0.993,
   "spearmanAll": 0.988,
   "spearmanAllWithOwners": 0.986,
   "top50": {
    "n": 50,
    "spearman": 0.887,
    "mape": 0.036,
    "biasPct": -0.024,
    "biasPctOfficialFactors": -0.024,
    "overlap": 0.92,
    "withOwners": {
     "spearman": 0.829,
     "mape": 0.046,
     "biasPct": 0.014,
     "overlap": 0.7
    }
   },
   "top150": {
    "n": 150,
    "spearman": 0.912,
    "mape": 0.058,
    "biasPct": -0.038,
    "biasPctOfficialFactors": -0.038,
    "overlap": 0.893,
    "withOwners": {
     "spearman": 0.825,
     "mape": 0.083,
     "biasPct": 0.059,
     "overlap": 0.867
    }
   }
  },
  "spearmanSeasonTotal": 0.912
 },
 "MLB": {
  "sport": "MLB",
  "trainSeasons": [
   2023,
   2024
  ],
  "testSeason": 2025,
  "nTrain": 8753,
  "n": 3865,
  "r2Rating": 0.9671,
  "maeRating": 0.187,
  "maeRax": 0.621,
  "maeRaxRatingOnly": 0.281,
  "exactRax": 0.697,
  "within1Rax": 0.905,
  "r2RatingPreDec2025": 0.9671,
  "maeRaxPreDec2025": 0.621,
  "byGroup": {
   "P": {
    "n": 1206,
    "r2": 0.9791,
    "maeRating": 0.1672,
    "maeRax": 1.248,
    "exact": 0.606
   },
   "H": {
    "n": 2659,
    "r2": 0.9582,
    "maeRating": 0.196,
    "maeRax": 0.337,
    "exact": 0.739
   }
  },
  "annual": {
   "route": "box",
   "matched": 1409,
   "coverageTop150": 1,
   "spearmanAll": 0.986,
   "spearmanAllWithOwners": 0.991,
   "top50": {
    "n": 50,
    "spearman": 0.645,
    "mape": 0.219,
    "biasPct": -0.224,
    "biasPctOfficialFactors": 0.035,
    "overlap": 0.68,
    "withOwners": {
     "spearman": 0.726,
     "mape": 0.19,
     "biasPct": -0.196,
     "overlap": 0.74
    }
   },
   "top150": {
    "n": 150,
    "spearman": 0.63,
    "mape": 0.177,
    "biasPct": -0.182,
    "biasPctOfficialFactors": 0.086,
    "overlap": 0.84,
    "withOwners": {
     "spearman": 0.691,
     "mape": 0.147,
     "biasPct": -0.152,
     "overlap": 0.9
    }
   }
  },
  "spearmanSeasonTotal": 0.63
 }
};
// END GENERATED MODEL_ACCURACY

/* ------------------------------ evaluator ------------------------------ */

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

function condHolds(st: StatRecord, c: Cond): boolean {
  const a = num(st[c[0]]);
  switch (c[1]) {
    case '>=': return a >= c[2];
    case '>': return a > c[2];
    case '<=': return a <= c[2];
    case '<': return a < c[2];
    case '==': return a === c[2];
    default: return a !== c[2];
  }
}
const groupMatches = (g: RatingGroup, st: StatRecord) => !g.when || g.when.length === 0 || g.when.some((cl) => cl.every((c) => condHolds(st, c)));

/** Sports with a fitted rating model. Golf and soccer are not modeled (see MODEL_NOTES). */
export function isModeled(sport: OtdSport): boolean {
  return !!MODEL_DATA[sport];
}

function withCtx(stats: StatRecord, ctx: RatingCtx): StatRecord {
  return { ...stats, win: ctx.won ? 1 : 0, post: ctx.postseason ? 1 : 0 };
}

/** Which group (QB, SKILL, DEF, G, SP/RP pitcher, …) a stat line belongs to. */
export function ratingGroup(sport: OtdSport, stats: StatRecord, ctx: RatingCtx = {}): RatingGroup | null {
  const m = MODEL_DATA[sport];
  if (!m) return null;
  if (ctx.group) return m.groups.find((g) => g.id === ctx.group) ?? null;
  const st = withCtx(stats, ctx);
  return m.groups.find((g) => groupMatches(g, st)) ?? null;
}

/** Predicted Real game rating (NaN for sports without a model). Can be slightly negative for bad games. */
export function predictRating(sport: OtdSport, stats: StatRecord, ctx: RatingCtx = {}): number {
  const g = ratingGroup(sport, stats, ctx);
  if (!g) return NaN;
  const st = withCtx(stats, ctx);
  if (g.zeroIf && g.zeroIf.every((k) => num(st[k]) === 0)) return 0;
  let r = g.intercept;
  for (const t of g.terms) {
    let v = 0;
    for (const [k, c] of t.e) v += c * num(st[k]);
    if (t.f === 'hinge') v = Math.max(0, v - (t.t ?? 0));
    r += t.w * v;
  }
  if (g.min != null && r < g.min) r = g.min;
  if (g.max != null && r > g.max) r = g.max;
  return r;
}

function pitcherRole(g: RatingGroup, st: StatRecord, ctx: RatingCtx): string | undefined {
  if (ctx.role) return ctx.role;
  return g.roleRule ? (num(st[g.roleRule.key]) >= g.roleRule.min ? g.roleRule.hi : g.roleRule.lo) : undefined;
}

/** The rating→Rax factor k used for a group (×2 postseason). */
export function raxFactor(sport: OtdSport, stats: StatRecord, ctx: RatingCtx = {}): number {
  const g = ratingGroup(sport, stats, ctx);
  if (!g) return NaN;
  const st = withCtx(stats, ctx);
  const role = pitcherRole(g, st, ctx);
  let k: RaxFactor = g.k;
  if (role && g.kRole?.[role]) k = g.kRole[role];
  if (ctx.factors === 'rateboard' && ctx.season != null) {
    const season = ctx.season;
    const pick = <T extends { from: number }>(list: T[]): T | undefined => [...list].filter((o) => o.from <= season).sort((a, b) => b.from - a.from)[0];
    const ov = g.kSeasons && pick(g.kSeasons);
    if (ov) k = ov;
    const rov = role && g.kRoleSeasons && pick(g.kRoleSeasons);
    if (rov && typeof rov[role] === 'object') k = rov[role] as RaxFactor;
  }
  return ctx.postseason ? k.post : k.reg;
}

/**
 * Empirical low-owner uplift seen in Rateboard's stored Rax in the recent "live" regime (NFL / NHL / NBA / CBB games from
 * ≈ Dec 2025, CFB and MLB from ≈ Sept, WNBA throughout — mechanism unknown, see docs/RATING-MODEL.md). It depends on how
 * obscure the player is: `[maxPercentile, multiplier]` over the player's owner-count PERCENTILE inside his sport-season
 * (0 = fewest owners, 1 = most). The pooled medians over NFL / CFB / CBB / NBA / NHL / WNBA were ≈ 1.48 / 1.37 / 1.20 / 1.00.
 */
export const OWNERS_UPLIFT_PCT: Array<[maxPercentile: number, mult: number]> = [
  [0.5, 1.48],
  [0.75, 1.37],
  [0.9, 1.2],
  [Infinity, 1],
];
export function ownersUplift(percentile: number | null | undefined): number {
  if (percentile == null || !Number.isFinite(percentile)) return 1;
  for (const [max, mult] of OWNERS_UPLIFT_PCT) if (percentile < max) return mult;
  return 1;
}
/** Share of `allOwners` that is strictly below `owners` (feed it the sport-season's player list from Rateboard). */
export function ownersPercentile(owners: number, allOwners: number[]): number {
  if (!allOwners.length) return 1;
  let below = 0;
  for (const o of allOwners) if (o < owners) below++;
  return below / allOwners.length;
}

/** General-level Rax for a rating: `max(0, round(k × rating))` (half-up), × owner uplift if `ctx.ownersPercentile` is given. */
export function ratingToRax(sport: OtdSport, rating: number, ctx: RatingCtx & { stats?: StatRecord } = {}): number {
  const k = raxFactor(sport, ctx.stats ?? {}, ctx);
  if (!Number.isFinite(k) || !Number.isFinite(rating)) return 0;
  return Math.max(0, Math.floor(k * rating * ownersUplift(ctx.ownersPercentile) + 0.5));
}

/** Stats line → predicted General-level Rax of that game. */
export function predictRax(sport: OtdSport, stats: StatRecord, ctx: RatingCtx = {}): number {
  const rating = predictRating(sport, stats, ctx);
  return ratingToRax(sport, rating, { ...ctx, stats });
}

/* ------------------------------ caveats ------------------------------ */

export const MODEL_NOTES: string[] = [
  'Real does not publish its rating formula. These are statistical reconstructions (ridge-OLS on Rateboard\'s stored ratings vs ESPN box-score lines); the rating → Rax step is exact, the stats → rating step is not.',
  'rax = max(0, round(k × rating)) held on 100% of checked NBA / NFL / NHL / MLB hitter rows; k = published per-sport factor (NBA 1, WNBA 2, CBB 2.5, NFL 5 / defense+punters 7, CFB 5 / defense+punters 8, NHL 1.2 / goalies 3, MLB hitters 2 / SP 3 / RP 5), doubled in the postseason.',
  'Rateboard\'s stored Rax is NOT always base × k. In seasons/games from ≈ Dec of the 2025-26 regime (NFL 2025, NBA 2026, CBB 2025+, CFB, WNBA, MLB, NHL) low-owner players earn up to ≈ ×1.5 more, ramping with how few people own the card; stars with 10k+ owners are unaffected. The model cannot see owners unless you pass ctx.ownersPercentile.',
  'Rateboard\'s MLB 2025 values use the pre-buff factors (hitters 1.5×, SP 2×, RP 4×); older MLB seasons use 2/3/5. ctx.factors:\'rateboard\' reproduces that; the default is Real\'s current published factors.',
  'Defensive players are the weakest part (NFL / CFB DEF R² ≈ 0.8–0.9): Real\'s defensive ratings clearly use information box scores lack (snap counts, pressures, coverage).',
  'Pitcher role (SP vs RP factor) is inferred per game from outs recorded (≥12 → SP); Real appears to use the pitcher\'s card role, so ≈ 3–5% of pitcher games get the wrong factor.',
  'Win probability / play-by-play leverage was tested for NBA and did not improve held-out error (R² 0.9612 → 0.9625), so it is not used.',
  'Golf and soccer are not modeled: their ratings depend on the whole field\'s scores (relative performance), which a per-player box score does not determine.',
];
