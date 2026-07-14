// Dev fixtures — REAL responses captured 2026-07-04 from the live Worker
// (release 6276183 = Kind Of Blue 1959 US 6-eye mono, "Adderly" misprint;
// master 5460). Used only when sidepanel.html is opened outside Chrome's
// extension context, e.g. `sidepanel.html?demo=release`.

window.COPILOT_FIXTURES = {
  // GET /api/analyze?release=6276183&axis=sonic -> ReleaseAnalysis
  release: {
    "release": {
      "id": 6276183,
      "title": "Kind Of Blue",
      "artists": [
        "Miles Davis"
      ],
      "year": 1959,
      "country": "US",
      "label": "Columbia",
      "catno": "CL 1355",
      "format": "Vinyl LP Album Misprint Mono"
    },
    "axis": "sonic",
    "thisPressing": {
      "releaseId": 6276183,
      "title": "Kind Of Blue",
      "country": "US",
      "year": 1959,
      "released": "1959-08-17",
      "label": "Columbia",
      "catno": "CL 1355",
      "format": "Vinyl LP Album Misprint Mono",
      "rating": 4.83,
      "ratingCount": 127,
      "have": 2072,
      "want": 5340,
      "lowestPrice": 42.53,
      "numForSale": 9,
      "notesExcerpt": "Recorded on March 2 & April 22, 1959.\nLabels are both side US Mono 6-Eye with Deep Groove, 'Made in U. S. A.' printed below.\n\n• On front cover, we read 'Adderly' instead of 'Adderley' (pic. 1).\n• Same mistake on back cover (pic. 2).\n• Tracks B1 & B2 are reversed on back cover. B1 is supposed to read",
      "overallScore": 52.8,
      "evidenceCoverage": 0.66,
      "verdict": "solid pick",
      "factors": {
        "pedigree": {
          "score": 6,
          "confidence": 0.25,
          "weight": 0.45
        },
        "format": {
          "score": 65,
          "confidence": 1,
          "weight": 0.15
        },
        "ratingDelta": {
          "score": 56,
          "confidence": 1,
          "weight": 0.25
        },
        "marketValue": {
          "score": 66,
          "confidence": 1,
          "weight": 0.1
        },
        "consensus": {
          "score": 79.4,
          "confidence": 1,
          "weight": 0.05
        }
      },
      "signals": [
        "Early stamper (matrix …-1x)"
      ],
      "reputationDetail": {
        "engineers": [],
        "stampers": [
          "Early stamper (matrix …-1x)"
        ],
        "formatCues": []
      },
      "masteringCredits": [],
      "matrixRunout": [
        {
          "type": "Matrix / Runout",
          "value": "XLP47324-1J",
          "description": "Runout stamp side A, variant 1"
        },
        {
          "type": "Matrix / Runout",
          "value": "XLP47325-1J",
          "description": "Runout stamp side B, variant 1"
        },
        {
          "type": "Matrix / Runout",
          "value": "XLP47324-1B",
          "description": "Runout side A, variant 2"
        },
        {
          "type": "Matrix / Runout",
          "value": "XLP47325-1B",
          "description": "Runout side B, variant 2"
        }
      ],
      "pressingCompanies": [],
      "ratingDelta": {
        "value": 0.12,
        "albumBaselineRating": 4.71
      },
      "whyItScores": "Early stamper (matrix …-1x)",
      "inYourCollection": false
    },
    "bestPressing": {
      "rank": 1,
      "releaseId": 5189885,
      "title": "Kind Of Blue",
      "country": "US",
      "year": 1999,
      "released": "1999",
      "label": "Columbia",
      "catno": "CS 8163",
      "format": "Vinyl LP 45 RPM Single Sided Album Reissue Remastered",
      "rating": 4.82,
      "ratingCount": 34,
      "have": 175,
      "want": 1424,
      "lowestPrice": 204.91,
      "numForSale": 12,
      "notesExcerpt": "Classic Records 45 Series\n\nTwo discs in gatefold sleeve which is from this release [url=http://www.discogs.com/Miles-Davis-Kind-Of-Blue/release/3841623] 3841623[/url], second two are in white card sleeves.\n\nRecorded 02/03/1959 and 22/04/1959. \n\n\n",
      "overallScore": 85.6,
      "evidenceCoverage": 0.92,
      "verdict": "strong sonic pick",
      "factors": {
        "pedigree": {
          "score": 99,
          "confidence": 1,
          "weight": 0.45
        },
        "format": {
          "score": 75,
          "confidence": 1,
          "weight": 0.15
        },
        "ratingDelta": {
          "score": 55,
          "confidence": 0.68,
          "weight": 0.25
        },
        "marketValue": {
          "score": 93,
          "confidence": 1,
          "weight": 0.1
        },
        "consensus": {
          "score": 85.5,
          "confidence": 1,
          "weight": 0.05
        }
      },
      "signals": [
        "Classic Records (reissue label)",
        "Mastered/cut by Bernie Grundman",
        "Bernie Grundman Mastering (Remastered At)",
        "45 RPM cut"
      ],
      "reputationDetail": {
        "engineers": [
          "Bernie Grundman"
        ],
        "stampers": [],
        "formatCues": [
          "45 RPM cut"
        ],
        "label": {
          "id": 22206,
          "name": "Classic Records",
          "weight": 85
        },
        "studio": "Bernie Grundman Mastering"
      },
      "masteringCredits": [
        "Bernie Grundman — Remastered By"
      ],
      "matrixRunout": [
        {
          "type": "Matrix / Runout",
          "value": "CS-8163-C1-45 Bernie Grundman"
        },
        {
          "type": "Matrix / Runout",
          "value": "CS-8163-C2-45 Bernie Grundman"
        },
        {
          "type": "Matrix / Runout",
          "value": "CS-8163-B1-45 Bernie Grundman"
        },
        {
          "type": "Matrix / Runout",
          "value": "CS-8163-B2-45 Bernie Grundman"
        }
      ],
      "pressingCompanies": [
        {
          "name": "Classic Records, Inc.",
          "entityTypeName": "Manufactured By"
        },
        {
          "name": "Classic Records, Inc.",
          "entityTypeName": "Distributed By"
        },
        {
          "name": "Sony Music Entertainment Inc.",
          "entityTypeName": "Licensed From"
        },
        {
          "name": "Sony Music Special Products",
          "entityTypeName": "Licensed From"
        },
        {
          "name": "Bernie Grundman Mastering",
          "entityTypeName": "Remastered At"
        }
      ],
      "ratingDelta": {
        "value": 0.11,
        "albumBaselineRating": 4.71
      },
      "whyItScores": "Classic Records (reissue label); Mastered/cut by Bernie Grundman; Bernie Grundman Mastering (Remastered At)",
      "inYourCollection": false
    },
    "albumBaselineRating": 4.71,
    "tasteFit": {
      "affinity": 16.8,
      "collectionSize": 307,
      "dominantStyles": [
        {
          "name": "Contemporary Jazz",
          "share": 11.1
        },
        {
          "name": "Soul-Jazz",
          "share": 9.1
        },
        {
          "name": "Pop Rock",
          "share": 8.8
        },
        {
          "name": "Fusion",
          "share": 5.2
        },
        {
          "name": "Avant-garde Jazz",
          "share": 4.6
        }
      ],
      "dominantGenres": [
        "Jazz",
        "Rock",
        "Electronic"
      ]
    },
    "owned": false,
    "wanted": false,
    "dataCaveats": [
      "Scoring is reputation- and community-data-based, not measured audio quality.",
      "Ratings are user-submitted and can be thin for obscure pressings.",
      "Discogs version listings carry no ratings, so only the bounded candidate set is fully scored.",
      "The version list was truncated; not every pressing was surveyed."
    ]
  },

  // GET /api/best-pressing?master=5460&axis=sonic -> FindBestPressingResult
  master: {
    "album": {
      "title": "Kind Of Blue",
      "artists": [
        "Miles Davis"
      ],
      "originalYear": 1959,
      "masterId": 5460,
      "totalVersionsSurveyed": 300,
      "candidatesScored": 16,
      "candidatesAttempted": 16,
      "versionsListTruncated": true
    },
    "axis": "sonic",
    "partial": false,
    "albumBaselineRating": 4.71,
    "dataCaveats": [
      "Scoring is reputation- and community-data-based, not measured audio quality.",
      "Ratings are user-submitted and can be thin for obscure pressings.",
      "Discogs version listings carry no ratings, so only the bounded candidate set is fully scored.",
      "The version list was truncated; not every pressing was surveyed."
    ],
    "topPressings": [
      {
        "rank": 1,
        "releaseId": 5189885,
        "title": "Kind Of Blue",
        "country": "US",
        "year": 1999,
        "released": "1999",
        "label": "Columbia",
        "catno": "CS 8163",
        "format": "Vinyl LP 45 RPM Single Sided Album Reissue Remastered",
        "rating": 4.82,
        "ratingCount": 34,
        "have": 175,
        "want": 1424,
        "lowestPrice": 204.91,
        "numForSale": 12,
        "notesExcerpt": "Classic Records 45 Series\n\nTwo discs in gatefold sleeve which is from this release [url=http://www.discogs.com/Miles-Davis-Kind-Of-Blue/release/3841623] 3841623[/url], second two are in white card sleeves.\n\nRecorded 02/03/1959 and 22/04/1959. \n\n\n",
        "overallScore": 85.6,
        "evidenceCoverage": 0.92,
        "verdict": "strong sonic pick",
        "factors": {
          "pedigree": {
            "score": 99,
            "confidence": 1,
            "weight": 0.45
          },
          "format": {
            "score": 75,
            "confidence": 1,
            "weight": 0.15
          },
          "ratingDelta": {
            "score": 55,
            "confidence": 0.68,
            "weight": 0.25
          },
          "marketValue": {
            "score": 93,
            "confidence": 1,
            "weight": 0.1
          },
          "consensus": {
            "score": 85.5,
            "confidence": 1,
            "weight": 0.05
          }
        },
        "signals": [
          "Classic Records (reissue label)",
          "Mastered/cut by Bernie Grundman",
          "Bernie Grundman Mastering (Remastered At)",
          "45 RPM cut"
        ],
        "reputationDetail": {
          "engineers": [
            "Bernie Grundman"
          ],
          "stampers": [],
          "formatCues": [
            "45 RPM cut"
          ],
          "label": {
            "id": 22206,
            "name": "Classic Records",
            "weight": 85
          },
          "studio": "Bernie Grundman Mastering"
        },
        "masteringCredits": [
          "Bernie Grundman — Remastered By"
        ],
        "matrixRunout": [
          {
            "type": "Matrix / Runout",
            "value": "CS-8163-C1-45 Bernie Grundman"
          },
          {
            "type": "Matrix / Runout",
            "value": "CS-8163-C2-45 Bernie Grundman"
          },
          {
            "type": "Matrix / Runout",
            "value": "CS-8163-B1-45 Bernie Grundman"
          },
          {
            "type": "Matrix / Runout",
            "value": "CS-8163-B2-45 Bernie Grundman"
          }
        ],
        "pressingCompanies": [
          {
            "name": "Classic Records, Inc.",
            "entityTypeName": "Manufactured By"
          },
          {
            "name": "Classic Records, Inc.",
            "entityTypeName": "Distributed By"
          },
          {
            "name": "Sony Music Entertainment Inc.",
            "entityTypeName": "Licensed From"
          },
          {
            "name": "Sony Music Special Products",
            "entityTypeName": "Licensed From"
          },
          {
            "name": "Bernie Grundman Mastering",
            "entityTypeName": "Remastered At"
          }
        ],
        "ratingDelta": {
          "value": 0.11,
          "albumBaselineRating": 4.71
        },
        "whyItScores": "Classic Records (reissue label); Mastered/cut by Bernie Grundman; Bernie Grundman Mastering (Remastered At)",
        "inYourCollection": false
      },
      {
        "rank": 2,
        "releaseId": 1800281,
        "title": "Kind Of Blue",
        "country": "US",
        "year": 2002,
        "released": "2002",
        "label": "Columbia",
        "catno": "CS 8163",
        "format": "Vinyl LP Album Reissue Remastered Stereo",
        "rating": 4.73,
        "ratingCount": 341,
        "have": 2655,
        "want": 1718,
        "lowestPrice": 65.25,
        "numForSale": 27,
        "notesExcerpt": "© 2001 Manufactured & distributed by Classic Records, Inc. under license from © ℗ Sony Music Entertainment Inc.\nOriginal Release recorded 02/03/1959 and 22/04/1959.\n[Note: Track-times not given on this release.]\nRunout matrix etched.",
        "overallScore": 76.3,
        "evidenceCoverage": 1,
        "verdict": "strong sonic pick",
        "factors": {
          "pedigree": {
            "score": 99,
            "confidence": 1,
            "weight": 0.45
          },
          "format": {
            "score": 60,
            "confidence": 1,
            "weight": 0.15
          },
          "ratingDelta": {
            "score": 51,
            "confidence": 1,
            "weight": 0.25
          },
          "marketValue": {
            "score": 73,
            "confidence": 1,
            "weight": 0.1
          },
          "consensus": {
            "score": 53.8,
            "confidence": 1,
            "weight": 0.05
          }
        },
        "signals": [
          "Classic Records (reissue label)",
          "Mastered/cut by Bernie Grundman",
          "Bernie Grundman Mastering (Remastered At)",
          "Bernie Grundman initials"
        ],
        "reputationDetail": {
          "engineers": [
            "Bernie Grundman"
          ],
          "stampers": [
            "Bernie Grundman initials"
          ],
          "formatCues": [],
          "label": {
            "id": 22206,
            "name": "Classic Records",
            "weight": 85
          },
          "studio": "Bernie Grundman Mastering"
        },
        "masteringCredits": [
          "Bernie Grundman — Remastered By, Lacquer Cut By"
        ],
        "matrixRunout": [
          {
            "type": "Matrix / Runout",
            "value": "XSM 47326",
            "description": "Label Side A"
          },
          {
            "type": "Matrix / Runout",
            "value": "XSM 47327",
            "description": "Label Side B"
          },
          {
            "type": "Matrix / Runout",
            "value": "CS 8163-C BG",
            "description": "Side A, Variant 1"
          },
          {
            "type": "Matrix / Runout",
            "value": "CS 8163-B BG 08",
            "description": "Side B, Variant 1"
          },
          {
            "type": "Matrix / Runout",
            "value": "CS 8163-C BG",
            "description": "Side A, Variant 2"
          },
          {
            "type": "Matrix / Runout",
            "value": "CS 8163-B BG",
            "description": "Side B, Variant 2"
          },
          {
            "type": "Matrix / Runout",
            "value": "CS 8163-C BG",
            "description": "Side A, Variant 3"
          },
          {
            "type": "Matrix / Runout",
            "value": "CS 8163-C  BG T",
            "description": "Side B, Variant 3"
          },
          {
            "type": "Matrix / Runout",
            "value": "CS 8163-C BG T",
            "description": "Side A, Variant 4"
          },
          {
            "type": "Matrix / Runout",
            "value": "CS 8163-B BG 08",
            "description": "Side B, Variant 4"
          },
          {
            "type": "Matrix / Runout",
            "value": "CS 8163-A BG T",
            "description": "Side A, Variant 5"
          },
          {
            "type": "Matrix / Runout",
            "value": "CS 8163-B BG 08",
            "description": "Side B, Variant 5"
          },
          {
            "type": "Matrix / Runout",
            "value": "CS 8163-C BG T",
            "description": "Side A, Variant 6"
          },
          {
            "type": "Matrix / Runout",
            "value": "CS 8163-B T BG 08",
            "description": "Side B, Variant 6"
          }
        ],
        "pressingCompanies": [
          {
            "name": "Classic Records",
            "entityTypeName": "Manufactured By"
          },
          {
            "name": "Classic Records",
            "entityTypeName": "Distributed By"
          },
          {
            "name": "Bernie Grundman Mastering",
            "entityTypeName": "Remastered At"
          },
          {
            "name": "Columbia",
            "entityTypeName": "Phonographic Copyright (p)"
          },
          {
            "name": "Sony Music Entertainment Inc.",
            "entityTypeName": "Licensed From"
          }
        ],
        "ratingDelta": {
          "value": 0.02,
          "albumBaselineRating": 4.71
        },
        "whyItScores": "Classic Records (reissue label); Mastered/cut by Bernie Grundman; Bernie Grundman Mastering (Remastered At)",
        "inYourCollection": false
      },
      {
        "rank": 3,
        "releaseId": 7943832,
        "title": "Kind Of Blue",
        "country": "US",
        "year": 1959,
        "released": "1959-08-17",
        "label": "Columbia",
        "catno": "CL 1355",
        "format": "Vinyl LP Album Mono",
        "rating": 4.64,
        "ratingCount": 22,
        "have": 272,
        "want": 1678,
        "lowestPrice": 65.25,
        "numForSale": 9,
        "notesExcerpt": "Recorded on March 2 & April 22, 1959. \nLabels are both side US Mono 6-Eye, 'Made in U. S. A.' printed below. \n\nThis cover is misprinted: \n• On front cover, we read 'Adderly' instead of 'Adderley' \n• Same mistake on back cover \n• B side tracks are reversed on back cover. 'Flamenco Sketches' comes fir",
        "overallScore": 64.2,
        "evidenceCoverage": 0.41,
        "verdict": "solid pick",
        "factors": {
          "pedigree": {
            "score": 0,
            "confidence": 0,
            "weight": 0.45
          },
          "format": {
            "score": 65,
            "confidence": 1,
            "weight": 0.15
          },
          "ratingDelta": {
            "score": 46,
            "confidence": 0.44,
            "weight": 0.25
          },
          "marketValue": {
            "score": 73,
            "confidence": 1,
            "weight": 0.1
          },
          "consensus": {
            "score": 84.2,
            "confidence": 1,
            "weight": 0.05
          }
        },
        "signals": [],
        "reputationDetail": {
          "engineers": [],
          "stampers": [],
          "formatCues": []
        },
        "masteringCredits": [],
        "matrixRunout": [
          {
            "type": "Matrix / Runout",
            "value": "XLP47324-1BH",
            "description": "Side A runout, stamped"
          },
          {
            "type": "Matrix / Runout",
            "value": "XLP47325-1BC",
            "description": "Side B runout, stamped"
          }
        ],
        "pressingCompanies": [],
        "ratingDelta": {
          "value": -0.07,
          "albumBaselineRating": 4.71
        },
        "whyItScores": "No strong mastering or pressing reputation signals found",
        "inYourCollection": false
      }
    ]
  },

  // GET /api/profile — hand-built in the live response shape (demo=home)
  profile: {
    "username": "vinylfan",
    "collectionSize": 307,
    "wantlistSize": 163,
    "truncated": false,
    "dominantStyles": [
      { "name": "Contemporary Jazz", "share": 11.1 },
      { "name": "Hard Bop", "share": 9.4 },
      { "name": "Modal", "share": 7.2 },
      { "name": "Fusion", "share": 5.9 },
      { "name": "Psychedelic Rock", "share": 4.6 }
    ],
    "dominantGenres": ["Jazz", "Rock", "Electronic"],
    "decades": [
      { "name": "1970s", "share": 31 },
      { "name": "1960s", "share": 24 },
      { "name": "1990s", "share": 12 }
    ],
    "topLabels": ["Blue Note", "Columbia", "Impulse!"],
    "formatSplit": { "vinyl": 84, "cd": 12, "other": 4 },
    "addedThisMonth": 4,
    "recentlyAdded": [
      { "id": 6276183, "title": "Kind Of Blue", "artists": ["Miles Davis"], "year": 1959, "dateAdded": "2026-07-05T09:12:00-07:00" },
      { "id": 2015527, "title": "A Love Supreme", "artists": ["John Coltrane"], "year": 1965, "dateAdded": "2026-07-02T18:40:00-07:00" },
      { "id": 1250628, "title": "Head Hunters", "artists": ["Herbie Hancock"], "year": 1973, "dateAdded": "2026-06-28T11:05:00-07:00" },
      { "id": 373301, "title": "Bitches Brew", "artists": ["Miles Davis"], "year": 1970, "dateAdded": "2026-06-21T15:30:00-07:00" },
      { "id": 521936, "title": "Maiden Voyage", "artists": ["Herbie Hancock"], "year": 1965, "dateAdded": "2026-06-14T10:00:00-07:00" }
    ],
    "moods": ["mellow", "relaxed", "peaceful", "dreamy", "intimate", "cozy", "energetic", "upbeat", "party", "pumped", "joyful", "dark", "melancholic", "moody", "sad", "noir", "focus", "productive", "study", "sunday", "morning", "latenight", "summer", "rainy", "groovy", "psychedelic", "epic", "raw", "smooth", "spiritual", "romantic", "nostalgic"]
  },

  // GET /api/spin?mood=latenight (demo=home; mood is overwritten by the tapped chip)
  spin: {
    "mood": "latenight",
    "poolSize": 41,
    "picks": [
      { "id": 2015527, "title": "A Love Supreme", "artists": ["John Coltrane"], "year": 1965, "rating": 5, "matchedStyles": ["Hard Bop"], "why": "Matches latenight: Hard Bop" },
      { "id": 6276183, "title": "Kind Of Blue", "artists": ["Miles Davis"], "year": 1959, "rating": 5, "matchedStyles": ["Cool Jazz"], "why": "Matches latenight: Cool Jazz" },
      { "id": 1077245, "title": "Mezzanine", "artists": ["Massive Attack"], "year": 1998, "rating": 4, "matchedStyles": ["Trip Hop"], "why": "Matches latenight: Trip Hop" }
    ]
  },

  // chrome.storage.local.recentAnalyses (demo=home)
  recentAnalyses: [
    { "releaseId": 6276183, "title": "Kind Of Blue", "artist": "Miles Davis", "axis": "sonic", "score": 52.8, "verdict": "solid pick", "ts": Date.now() - 35 * 60 * 1000 },
    { "releaseId": 1250628, "title": "Head Hunters", "artist": "Herbie Hancock", "axis": "sonic", "score": 71.4, "verdict": "strong sonic pick", "ts": Date.now() - 5 * 60 * 60 * 1000 },
    { "releaseId": 373301, "title": "Bitches Brew", "artist": "Miles Davis", "axis": "collector", "score": 64.0, "verdict": "solid pick", "ts": Date.now() - 26 * 60 * 60 * 1000 },
    { "releaseId": 999451, "title": "In A Silent Way", "artist": "Miles Davis", "axis": "sonic", "score": 38.2, "verdict": "weak evidence", "ts": Date.now() - 3 * 24 * 60 * 60 * 1000 }
  ],
};

// GET /api/analyze?...&mode=summary — derived from the full fixture: the
// viewed pressing renders instantly, the survey (bestPressing) comes later.
window.COPILOT_FIXTURES.summary = (() => {
  const full = window.COPILOT_FIXTURES.release;
  return {
    ...full,
    bestPressing: null,
    dataCaveats: ["Scoring is reputation- and community-data-based, not measured audio quality."],
    meta: {
      level: "summary",
      cacheStatus: "miss",
      personalization: "ready",
      candidatesScored: null,
      candidatesTarget: null,
      upstreamCalls: 1,
    },
  };
})();
