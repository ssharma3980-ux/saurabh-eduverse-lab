/* Saurabh's EDUVERSE — list of games.
   To add a new game:
   1. Put its files in  games/class-<N>/<game-name>/index.html
   2. Put an 800x500 picture next to it called thumbnail.webp (or .png / .jpg)
   3. Add one line below. "topic" must be one of the keys in i18n.js (topics),
      or write the topic in English as "topicText". */
window.EDU_GAMES = [
  { cls: 1,  path: 'class-1/festival-islands-3d',     title: 'Festival Islands 3D',           ch: 12, topic: 'fest',    emoji: '🪔' },
  { cls: 1,  path: 'class-1/helper-town-express',     title: 'Helper Town Express',           ch: 10, topic: 'work',    emoji: '🛺' },
  { cls: 3,  path: 'class-3/bubbly-healthy-island-3d',title: "Bubbly's Healthy Happy Island 3D", ch: 9, topic: 'health', emoji: '🫧' },
  { cls: 3,  path: 'class-3/birbal-crow-count',       title: "Birbal's Crow Count",           ch: 0,  topic: 'hund',    emoji: '🐦' },
  { cls: 6,  path: 'class-6/bharat-ki-yatra-3d',      title: 'Bharat ki Yatra 3D',            ch: 9,  topic: 'sep',     emoji: '🚂' },
  { cls: 6,  path: 'class-6/boondi-water-journey-3d', title: "Boondi's Water Journey 3D",     ch: 8,  topic: 'water',   emoji: '💧' },
  { cls: 6,  path: 'class-6/taapu-temperature-trek',  title: "Taapu's Temperature Trek",      ch: 7,  topic: 'temp',    emoji: '🌡️' },
  { cls: 9,  path: 'class-9/newton-games-3d',         title: 'Newton Games 3D',               ch: 6,  topic: 'force',   emoji: '🏆' },
  { cls: 9,  path: 'class-9/atom-lab-quest-3d',       title: 'Atom Lab Quest 3D',             ch: 9,  topic: 'atom',    emoji: '⚛️' },
  { cls: 9,  path: 'class-9/earth-system-quest-3d',   title: 'Earth System Quest 3D',         ch: 13, topic: 'earth',   emoji: '🌍' },
  { cls: 9,  path: 'class-9/physics-frontier',        title: 'Physics Frontier',              ch: 0,  topic: 'phys',    emoji: '🏙️',
    files: ['three.min.js','vendor.js','game.js','models/soldier.js','models/michelle.js','models/xbot.js','textures/waternormals.jpg'] },
  { cls: 10, path: 'class-10/reaction-express-3d',    title: 'Reaction Express 3D',           ch: 1,  topic: 'react',   emoji: '🚂' },
  { cls: 10, path: 'class-10/ph-rainbow-isles-3d',    title: 'pH Rainbow Isles 3D',           ch: 2,  topic: 'acid',    emoji: '🌈' },
  { cls: 10, path: 'class-10/metal-mountain-mine-3d', title: 'Metal Mountain Mine 3D',        ch: 3,  topic: 'metals',  emoji: '⛏️' },
  { cls: 10, path: 'class-10/life-engine-3d',         title: 'Life Engine 3D',                ch: 5,  topic: 'life',    emoji: '🫁' },
  { cls: 10, path: 'class-10/generation-spiral-3d',   title: 'Generation Spiral 3D',          ch: 7,  topic: 'repro',   emoji: '🌸' },
  { cls: 10, path: 'class-10/pea-code-garden-3d',     title: 'Pea Code Garden 3D',            ch: 8,  topic: 'hered',   emoji: '🫛' },
  { cls: 10, path: 'class-10/lumina-lighthouse-3d',   title: 'Lumina Lighthouse 3D',          ch: 9,  topic: 'light',   emoji: '🗼' },
  { cls: 10, path: 'class-10/iris-arch-3d',           title: 'Iris Arch 3D',                  ch: 10, topic: 'eye',     emoji: '👁️' },
  { cls: 10, path: 'class-10/little-green-planet-3d', title: 'Little Green Planet 3D',        ch: 13, topic: 'env',     emoji: '🌳' },
  { cls: 10, path: 'class-10/litmus-lab',             title: 'Litmus Lab',                    ch: 2,  topic: 'acid',    emoji: '🧪' },
  { cls: 10, path: 'class-10/carbon-citadel-3d',      title: 'Carbon Citadel 3D',             ch: 4,  topic: 'carbon',  emoji: '🏰' },
  { cls: 10, path: 'class-10/synapse-voyager',        title: 'Synapse Voyager',               ch: 6,  topic: 'control', emoji: '🧠' },
  { cls: 10, path: 'class-10/neuroatlas-3d',          title: 'NeuroAtlas 3D',                 ch: 6,  topic: 'control', emoji: '🧬' },
  { cls: 10, path: 'class-10/volt-city-3d',           title: 'Volt City 3D',                  ch: 11, topic: 'elec',    emoji: '⚡' },
  { cls: 10, path: 'class-10/magnet-quest-3d',        title: 'Magnet Quest 3D',               ch: 13, topic: 'magnet',  emoji: '🧲' },
  { cls: 10, path: 'class-10/magnet-heredity-quiz',   title: 'Magnet & Heredity MCQ Quiz',    ch: 0,  topic: 'quiz',    emoji: '📝' },

  /* Fun & Skills (not tied to a class) */
  { cls: 0, fun: true, path: 'fun/india-run',               title: 'INDIA RUN: Legends of Bharat', topicText: '3D endless run across 15 Indian cities', emoji: '🏃' },
  { cls: 0, fun: true, path: 'fun/turbo-horizon-bharat',   title: 'Turbo Horizon: Bharat Edition', topic: 'race', emoji: '🏎️',
    files: ['../../vendor/three-r128/three.min.js','../../vendor/three-r128/postprocessing/EffectComposer.js','../../vendor/three-r128/postprocessing/RenderPass.js','../../vendor/three-r128/postprocessing/ShaderPass.js','../../vendor/three-r128/postprocessing/UnrealBloomPass.js','../../vendor/three-r128/shaders/CopyShader.js','../../vendor/three-r128/shaders/GammaCorrectionShader.js','../../vendor/three-r128/shaders/LuminosityHighPassShader.js'] },
  { cls: 0, fun: true, path: 'fun/typenova-typing-trainer', title: 'TypeNova — Typing Trainer',    topic: 'type', emoji: '⌨️' },
  { cls: 0, fun: true, path: 'fun/hanami-koi-pond',         title: 'Hanami Koi Pond',              topic: 'koi',  emoji: '🎏',
    files: ['../../vendor/three-r128/three.min.js'] },

  /* Projects & Apps */
  { cls: 0, app: true, path: 'apps/ai-crop-doctor-pro',         title: 'AI Crop Doctor Pro',                       topic: 'crop',   emoji: '🌿' },
  { cls: 0, app: true, path: 'apps/ai-crop-doctor-3-languages', title: 'AI Crop Doctor (English · हिन्दी · ગુજરાતી)', topic: 'crop',   emoji: '🌾' },
  { cls: 0, app: true, path: 'apps/ai-crop-doctor-web',         title: 'AI Crop Doctor Web',                       topic: 'crop',   emoji: '🍃' },
  { cls: 0, app: true, path: 'apps/ai-crop-doctor-gujarati',    title: 'AI Crop Doctor (ગુજરાતી · English)',         topic: 'crop',   emoji: '🌱' },
  { cls: 0, app: true, path: 'apps/career-genius',              title: 'Career Genius',                            topic: 'career', emoji: '🎓' },
  { cls: 0, app: true, path: 'apps/trainable-bot-studio',       title: 'Trainable Bot Studio',                     topic: 'bot',    emoji: '🤖' }
];

/* 3D labs that are already on the website */
window.EDU_LABS = [
  { title: 'Saurabh Eduverse Laboratory', url: '../index.html',     emoji: '🔬' },
  { title: '3D Biology Discovery Lab',    url: '../bio/index.html#/',     emoji: '🫀' },
  { title: 'Chemistry Lab — Test tubes, Salt analysis & Titration', url: '../chemlab/index.html', emoji: '⚗️' },
  { title: 'Periodic Table 3D',           url: '../ptable/index.html',  emoji: '🧪' }
];
