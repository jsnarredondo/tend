"""Build the hosted Tend site from the Claude artifact source.
Usage: python3 build.py [path/to/artifact/index.html]
Takes the artifact's index.html (source of truth for app code), adds the
Supabase cloud layer and login, and patches Claude-only bits."""
import sys, shutil, pathlib, re
SRC = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/mnt/project-files/kids-health-app/index.html")
HERE = pathlib.Path(__file__).parent
OUT = HERE / "docs"
html = SRC.read_text()

def sub(old, new, count=1):
    global html
    n = html.count(old)
    assert n >= 1, f"patch target not found: {old[:80]!r}"
    html = html.replace(old, new) if count == 0 else html.replace(old, new, count)

# head: manifest, relative icons, noindex, cloud scripts
sub('<title>Tend</title>', '<title>Tend</title>\n<meta name="robots" content="noindex, nofollow">\n<meta property="og:title" content="Tend">\n<meta property="og:site_name" content="Tend">\n<meta property="og:type" content="website">\n<meta property="og:url" content="https://tend.llc/">\n<meta property="og:image" content="https://tend.llc/tend-icon-512.png">\n<meta property="og:image:width" content="512">\n<meta property="og:image:height" content="512">\n<meta name="twitter:card" content="summary">\n<meta name="twitter:title" content="Tend">\n<meta name="twitter:image" content="https://tend.llc/tend-icon-512.png">\n<link rel="manifest" href="manifest.webmanifest">')
html = re.sub(r'<link rel="icon" href="data:[^"]*">', '<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">', html)
html = re.sub(r'<link rel="apple-touch-icon" href="data:[^"]*">', '<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png">', html)
sub('</style>', (HERE / "src/cloud.css").read_text() + "\n</style>")
import hashlib
_v = hashlib.sha1((HERE / "src/cloud.js").read_bytes()).hexdigest()[:8]  # cache-bust on change
sub('<body>', f'<body>\n<script src="supabase.min.js"></script>\n<script src="cloud.js?v={_v}"></script>')

# keep the kids' names out of the public repo
sub('Miles is 101.2 and I gave him 7.5 of Motrin', 'He\'s 101.2 and I gave him 7.5 of Motrin')
# Claude-only wording
sub('toast("Sign in on claude.ai to save")', 'toast("Sign in to save")', 0)
sub('banner("Open Tend on claude.ai or in the Claude app to save entries.")', 'banner("Couldn\'t start Tend. Check your connection and reload.")')
sub('banner("Sign in on claude.ai or in the Claude app to save entries.")', 'banner("Sign in to see your saved data.")')
# Google Calendar toggle only when a calendar connection exists (not on the hosted site)
sub('<div class="f-row"><label>Also add to Google Calendar</label><label class="switch"><input type="checkbox" id="rCal" ${mcp?"checked":""}><span></span></label></div>',
    '${mcp?`<div class="f-row"><label>Also add to Google Calendar</label><label class="switch"><input type="checkbox" id="rCal" checked><span></span></label></div>`:""}')
# show server error messages from Tell Tend
sub(':"Couldn\'t understand that. Try again.");', ':(e.message&&!["error","parse"].includes(e.code)?e.message:"Couldn\'t understand that. Try again."));')
# care team: real members + invites
start = html.index("function renderTeam(){")
end = html.index("\n}\n", start) + 3
html = html[:start] + (HERE / "src/team.js").read_text().strip() + "\n" + html[end:]
# share text uses role names here
html = re.sub(r'if\(me&&user\.isOwner&&!\(await user\.isOwner\(\)\)\)\$\("shareText"\)\.textContent="[^"]*";', '', html)
assert 'shareText' not in html
sub(', or send it to Claude.', '.')
sub('Tend needs permission to use Claude to read photos.', 'Photo reading isn\'t set up yet.')

OUT.mkdir(exist_ok=True)
(OUT / "index.html").write_text(html)
shutil.copy(HERE / "src/cloud.js", OUT / "cloud.js")
shutil.copy(HERE / "src/sw.js", OUT / "sw.js")
shutil.copy(HERE / "src/supabase.min.js", OUT / "supabase.min.js")
icons = pathlib.Path("/mnt/project-files/tend-logos/final")
for f in ["apple-touch-icon.png", "favicon-32.png", "tend-icon-192.png", "tend-icon-512.png", "tend-icon.svg"]:
    if (icons / f).exists(): shutil.copy(icons / f, OUT / f)
(OUT / "manifest.webmanifest").write_text('{"name":"Tend","short_name":"Tend","start_url":"./","scope":"./","display":"standalone","background_color":"#eef3ff","theme_color":"#F0566A","icons":[{"src":"tend-icon-192.png","sizes":"192x192","type":"image/png"},{"src":"tend-icon-512.png","sizes":"512x512","type":"image/png"}]}')
(OUT / ".nojekyll").write_text("")
(OUT / "CNAME").write_text("tend.llc\n")
print("built", OUT / "index.html", len(html))
