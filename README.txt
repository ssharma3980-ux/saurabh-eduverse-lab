SAURABH EDUVERSE LABORATORY – website files
===========================================

What is inside
  index.html        Main lab: 3D campus, Physics, Chemistry, Biology, Maths
  assets/           Textures, sky and the 4 student characters
  bio/              3D Biology Discovery Laboratory (opens from the
                    "3D Biology Lab" button or the Biology department)
  netlify.toml      Netlify settings (browser caching for the big 3D files)

Put it online with Netlify (free)
  1. Unzip this file. You get a folder called "saurabh-eduverse-lab".
  2. Go to https://app.netlify.com/drop and sign in (or create a free account).
  3. Drag the whole "saurabh-eduverse-lab" folder onto the page.
  4. Wait for the upload (about 100 MB). Netlify gives you a link such as
     https://something-random.netlify.app
  5. Optional: Site configuration > Change site name, e.g.
     saurabh-eduverse-lab.netlify.app

To update later: open your site in Netlify > Deploys > drag the new folder
onto "Need to update your site? Drag and drop your site output folder here".

Notes
  - Open index.html directly from your computer will NOT load the 3D
    models (browsers block it). Use Netlify, or any web server.
  - three.js is loaded from cdn.jsdelivr.net, so the site needs internet.
  - 3D anatomy data credits: BodyParts3D (DBCLS, CC BY 4.0) and
    HuBMAP Human Reference Atlas (CC BY 4.0). Keep these credits.
