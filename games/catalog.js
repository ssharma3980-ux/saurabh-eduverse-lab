/* Saurabh's EDUVERSE — list of games.
   To add a new game:
   1. Put its files in  games/class-<N>/<game-name>/index.html
   2. Put an 800x500 picture next to it called thumbnail.webp (or .png / .jpg)
   3. Add one line below. "topic" must be one of the keys in i18n.js (topics),
      or write the topic in English as "topicText". */
window.EDU_GAMES = [
  { cls: 6,  path: 'class-6/bharat-ki-yatra-3d',      title: 'Bharat ki Yatra 3D',            ch: 9,  topic: 'sep',     emoji: '🚂' },
  { cls: 6,  path: 'class-6/boondi-water-journey-3d', title: "Boondi's Water Journey 3D",     ch: 8,  topic: 'water',   emoji: '💧' },
  { cls: 6,  path: 'class-6/taapu-temperature-trek',  title: "Taapu's Temperature Trek",      ch: 7,  topic: 'temp',    emoji: '🌡️' },
  { cls: 9,  path: 'class-9/newton-games-3d',         title: 'Newton Games 3D',               ch: 6,  topic: 'force',   emoji: '🏆' },
  { cls: 9,  path: 'class-9/atom-lab-quest-3d',       title: 'Atom Lab Quest 3D',             ch: 9,  topic: 'atom',    emoji: '⚛️' },
  { cls: 9,  path: 'class-9/earth-system-quest-3d',   title: 'Earth System Quest 3D',         ch: 13, topic: 'earth',   emoji: '🌍' },
  { cls: 9,  path: 'class-9/physics-frontier',        title: 'Physics Frontier',              ch: 0,  topic: 'phys',    emoji: '🏙️',
    files: ['three.min.js','vendor.js','game.js','models/soldier.js','models/michelle.js','models/xbot.js','textures/waternormals.jpg'] },
  { cls: 10, path: 'class-10/litmus-lab',             title: 'Litmus Lab',                    ch: 2,  topic: 'acid',    emoji: '🧪' },
  { cls: 10, path: 'class-10/carbon-citadel-3d',      title: 'Carbon Citadel 3D',             ch: 4,  topic: 'carbon',  emoji: '🏰' },
  { cls: 10, path: 'class-10/synapse-voyager',        title: 'Synapse Voyager',               ch: 6,  topic: 'control', emoji: '🧠' },
  { cls: 10, path: 'class-10/neuroatlas-3d',          title: 'NeuroAtlas 3D',                 ch: 6,  topic: 'control', emoji: '🧬' },
  { cls: 10, path: 'class-10/volt-city-3d',           title: 'Volt City 3D',                  ch: 11, topic: 'elec',    emoji: '⚡' },
  { cls: 10, path: 'class-10/magnet-quest-3d',        title: 'Magnet Quest 3D',               ch: 13, topic: 'magnet',  emoji: '🧲' },
  { cls: 10, path: 'class-10/magnet-heredity-quiz',   title: 'Magnet & Heredity MCQ Quiz',    ch: 0,  topic: 'quiz',    emoji: '📝' }
];

/* 3D labs that are already on the website */
window.EDU_LABS = [
  { title: 'Saurabh Eduverse Laboratory', url: '../index.html',     emoji: '🔬' },
  { title: '3D Biology Discovery Lab',    url: '../bio/index.html#/',     emoji: '🫀' },
  { title: 'Chemistry Lab — Titration',   url: '../chemlab/index.html', emoji: '⚗️' }
];
