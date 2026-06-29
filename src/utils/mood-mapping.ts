export interface MoodMapping {
  genres: string[];
  styles: string[];
  keywords: string[]; // Additional trigger terms
}

// Mood keywords → Discogs genres/styles
export const MOOD_MAP: Record<string, MoodMapping> = {
  // === Calm / Relaxed ===
  mellow:     { genres: ["Jazz", "Electronic", "Folk, World, & Country"], styles: ["Ambient", "Downtempo", "Bossa Nova", "Smooth Jazz", "Lo-Fi"], keywords: ["chill", "calm"] },
  relaxed:    { genres: ["Jazz", "Electronic", "Classical"], styles: ["Ambient", "Downtempo", "Lounge", "New Age", "Smooth Jazz"], keywords: ["peaceful"] },
  peaceful:   { genres: ["Classical", "Electronic", "Folk, World, & Country"], styles: ["Ambient", "New Age", "Minimalism", "Folk"], keywords: ["serene", "tranquil"] },
  dreamy:     { genres: ["Electronic", "Rock", "Pop"], styles: ["Shoegaze", "Dream Pop", "Ambient", "Ethereal", "Chillwave"], keywords: ["atmospheric"] },
  intimate:   { genres: ["Jazz", "Folk, World, & Country", "Blues"], styles: ["Vocal Jazz", "Singer-Songwriter", "Acoustic", "Chamber Jazz"], keywords: ["quiet", "soft"] },
  cozy:       { genres: ["Folk, World, & Country", "Jazz", "Pop"], styles: ["Folk", "Singer-Songwriter", "Acoustic", "Bossa Nova"], keywords: ["warm", "gentle"] },

  // === Energetic / Upbeat ===
  energetic:  { genres: ["Rock", "Electronic", "Hip Hop", "Funk / Soul"], styles: ["Punk", "House", "Disco", "Power Pop", "Hard Rock"], keywords: ["fast", "driving"] },
  upbeat:     { genres: ["Pop", "Funk / Soul", "Rock"], styles: ["Disco", "Synth-pop", "Power Pop", "Funk", "Soul"], keywords: ["happy", "fun"] },
  party:      { genres: ["Electronic", "Hip Hop", "Funk / Soul", "Pop"], styles: ["House", "Disco", "Dance-pop", "Electro", "Funk"], keywords: ["dance", "club"] },
  pumped:     { genres: ["Rock", "Electronic", "Hip Hop"], styles: ["Hard Rock", "Metal", "Drum n Bass", "Hardcore", "Trap"], keywords: ["intense", "aggressive"] },
  joyful:     { genres: ["Pop", "Funk / Soul", "Reggae"], styles: ["Soul", "Motown", "Ska", "Gospel", "Sunshine Pop"], keywords: ["cheerful", "bright"] },

  // === Dark / Moody ===
  dark:       { genres: ["Electronic", "Rock", "Jazz"], styles: ["Industrial", "Dark Ambient", "Gothic Rock", "Doom Metal", "Post-Punk"], keywords: ["brooding", "noir"] },
  melancholic:{ genres: ["Rock", "Classical", "Folk, World, & Country"], styles: ["Shoegaze", "Post-Rock", "Baroque", "Singer-Songwriter", "Emo"], keywords: ["wistful"] },
  moody:      { genres: ["Jazz", "Rock", "Electronic"], styles: ["Modal", "Post-Punk", "Trip Hop", "Dark Jazz", "Neo-Noir"], keywords: ["tension"] },
  sad:        { genres: ["Rock", "Folk, World, & Country", "Classical"], styles: ["Slowcore", "Singer-Songwriter", "Baroque", "Emo", "Chamber Music"], keywords: ["melancholy", "heartbreak"] },
  noir:       { genres: ["Jazz", "Electronic", "Rock"], styles: ["Hard Bop", "Trip Hop", "Dark Ambient", "Post-Punk", "Film Score"], keywords: ["smoky"] },

  // === Focus / Work ===
  focus:      { genres: ["Electronic", "Classical", "Jazz"], styles: ["Ambient", "Minimalism", "Modern Classical", "IDM", "Downtempo"], keywords: ["concentration", "study"] },
  productive: { genres: ["Electronic", "Jazz", "Classical"], styles: ["IDM", "Techno", "Minimalism", "Post-Bop", "Electro"], keywords: ["flow"] },
  study:      { genres: ["Classical", "Electronic", "Jazz"], styles: ["Baroque", "Ambient", "Lo-Fi", "Modal", "Minimalism"], keywords: ["background"] },

  // === Time / Season Vibes ===
  sunday:     { genres: ["Jazz", "Folk, World, & Country", "Classical", "Pop"], styles: ["Bossa Nova", "Folk", "Chamber Music", "Soft Rock", "Acoustic"], keywords: ["lazy"] },
  morning:    { genres: ["Jazz", "Folk, World, & Country", "Classical"], styles: ["Bossa Nova", "Folk", "Chamber Music", "Baroque", "Acoustic"], keywords: ["fresh"] },
  latenight:  { genres: ["Jazz", "Electronic", "Blues"], styles: ["Hard Bop", "Trip Hop", "Deep House", "Chicago Blues", "Cool Jazz"], keywords: ["midnight", "after hours"] },
  summer:     { genres: ["Pop", "Reggae", "Rock", "Electronic"], styles: ["Surf", "Ska", "Sunshine Pop", "Balearic", "Dub"], keywords: ["beach", "tropical"] },
  rainy:      { genres: ["Jazz", "Electronic", "Rock"], styles: ["Cool Jazz", "Ambient", "Shoegaze", "Post-Rock", "Trip Hop"], keywords: ["introspective"] },

  // === Genre-Adjacent Moods ===
  groovy:     { genres: ["Funk / Soul", "Jazz", "Electronic"], styles: ["Funk", "Acid Jazz", "Deep House", "Disco", "Soul-Jazz"], keywords: ["funky"] },
  psychedelic:{ genres: ["Rock", "Electronic"], styles: ["Psychedelic Rock", "Acid Rock", "Space Rock", "Krautrock", "Psytrance"], keywords: ["trippy"] },
  epic:       { genres: ["Rock", "Classical", "Electronic"], styles: ["Progressive Rock", "Symphonic Rock", "Film Score", "Post-Rock", "Orchestral"], keywords: ["grand", "cinematic"] },
  raw:        { genres: ["Rock", "Blues", "Hip Hop"], styles: ["Garage Rock", "Punk", "Delta Blues", "Boom Bap", "Noise"], keywords: ["gritty", "unpolished"] },
  smooth:     { genres: ["Jazz", "Funk / Soul"], styles: ["Smooth Jazz", "Contemporary R&B", "Quiet Storm", "Soul", "Neo-Soul"], keywords: ["silky"] },
  spiritual:  { genres: ["Jazz", "Classical", "Folk, World, & Country"], styles: ["Free Jazz", "Gospel", "Gregorian", "Raga", "Spiritual Jazz"], keywords: ["transcendent", "sacred"] },
  romantic:   { genres: ["Classical", "Jazz", "Pop"], styles: ["Romantic", "Vocal Jazz", "Chanson", "Bolero", "Ballad"], keywords: ["passionate"] },
  nostalgic:  { genres: ["Pop", "Rock", "Jazz"], styles: ["Doo Wop", "Rockabilly", "Swing", "Classic Rock", "Surf"], keywords: ["retro", "vintage", "oldies"] },
};

// Multi-word phrases checked before single keywords
const PHRASE_MAP: Record<string, string> = {
  "sunday morning": "sunday",
  "sunday evening": "mellow",
  "late night": "latenight",
  "after hours": "latenight",
  "rainy day": "rainy",
  "road trip": "energetic",
  "working out": "pumped",
  "workout": "pumped",
  "dinner party": "smooth",
  "coffee shop": "cozy",
  "winding down": "relaxed",
};

export const KNOWN_MOODS = Object.keys(MOOD_MAP);

/** Detect whether a free-text query expresses a mood. Returns the mood key or null. */
export function detectMoodFromQuery(query: string): string | null {
  const normalized = query.toLowerCase().trim();
  if (!normalized) return null;

  if (MOOD_MAP[normalized]) return normalized;

  for (const [phrase, mood] of Object.entries(PHRASE_MAP)) {
    if (normalized.includes(phrase)) return mood;
  }

  // Word-boundary matching so e.g. "sad" doesn't fire inside "Sade"
  const words = new Set(normalized.split(/[^a-z&/-]+/));
  for (const [mood, mapping] of Object.entries(MOOD_MAP)) {
    if (words.has(mood)) return mood;
    for (const kw of mapping.keywords) {
      if (kw.includes(" ") ? normalized.includes(kw) : words.has(kw)) return mood;
    }
  }

  return null;
}

export function getMoodFilters(mood: string): MoodMapping | null {
  return MOOD_MAP[mood.toLowerCase().trim()] ?? null;
}
