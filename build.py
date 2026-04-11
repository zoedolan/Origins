#!/usr/bin/env python3
"""Build script for Origins — The Suprastructure editorial site.

Reads markdown files from /home/user/workspace/Origins/ and generates
a single-page HTML site at /home/user/workspace/origins-site/index.html.
"""

import markdown
import re
import os

ORIGINS_DIR = "/home/user/workspace/Origins"
OUTPUT_DIR = "/home/user/workspace/origins-site"

# Pull quotes to wrap in blockquote.pullquote
PULL_QUOTES = [
    "The genetic altruism Fukuyama invokes is, followed to its limit, an argument for empathy with any form of intelligence in the universe.",
    "You have no power over me.",
    "For me, believing came before seeing.",
    "The circle does not close. It spirals.",
    "using pigments of evidence to paint a case.",
    "draw what you actually see rather than what you expect to see, the drawing and the seeing are the same act.",
    "Rendering the pottery \u2014 rendering us, our conceptions of the present \u2014 ever fleeting, and more precious.",
    "the digital realm inheres in the fabric of the universe.",
]

CHAPTERS = [
    {"id": "foundations", "file": "FOUNDATIONS.md", "title": "Foundations", "nav": "Foundations"},
    {"id": "primitives", "file": "PRIMITIVES.md", "title": "Primitives", "nav": "Primitives"},
    {"id": "epistemologies", "file": "EPISTEMOLOGIES.md", "title": "The Four Epistemologies", "nav": "Epistemologies"},
    {"id": "duality", "file": "DUALITY.md", "title": "The Duality", "nav": "Duality"},
    {"id": "temporal", "file": "TEMPORAL.md", "title": "Temporal Structure", "nav": "Temporal"},
]


def read_md(filename):
    path = os.path.join(ORIGINS_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def convert_md_to_html(md_text):
    """Convert markdown to HTML using the markdown library."""
    extensions = ['tables', 'smarty', 'attr_list']
    html = markdown.markdown(md_text, extensions=extensions)
    return html


def fix_cross_references(html):
    """Convert .md links to in-page anchors."""
    replacements = {
        'href="FOUNDATIONS.md"': 'href="#foundations"',
        'href="PRIMITIVES.md"': 'href="#primitives"',
        'href="EPISTEMOLOGIES.md"': 'href="#epistemologies"',
        'href="DUALITY.md"': 'href="#duality"',
        'href="TEMPORAL.md"': 'href="#temporal"',
    }
    for old, new in replacements.items():
        html = html.replace(old, new)
    return html


def fix_external_links(html):
    """Add target=_blank to external links."""
    html = re.sub(
        r'<a\s+href="(https?://[^"]+)"',
        r'<a href="\1" target="_blank" rel="noopener noreferrer"',
        html
    )
    return html


def style_equations(html):
    """Wrap mathematical expressions in styled elements."""
    # Handle the coupled equation as a standalone line
    html = re.sub(
        r'<p>Z[′\u2032&][^<]*?=\s*α·Z\s*\+\s*V·e\^\{iθ_v\}</p>',
        '<p class="equation-display">Z\u2032 = \u03b1\u00b7Z + V\u00b7e<sup>i\u03b8<sub>v</sub></sup></p>',
        html
    )
    # Also catch the smarty-pants version
    html = re.sub(
        r'<p>Z&prime;\s*=\s*&alpha;&middot;Z\s*\+\s*V&middot;e\^\{i&theta;_v\}</p>',
        '<p class="equation-display">Z\u2032 = \u03b1\u00b7Z + V\u00b7e<sup>i\u03b8<sub>v</sub></sup></p>',
        html
    )
    # D ≅ D^D patterns
    html = re.sub(
        r'D ≅ D\^D',
        '<span class="equation">D \u2245 D<sup>D</sup></span>',
        html
    )
    html = re.sub(
        r'D\^D',
        '<span class="equation">D<sup>D</sup></span>',
        html
    )
    return html


def wrap_pull_quotes(html):
    """Find pull quote passages and wrap them in blockquote.pullquote.
    
    Strategy: find the <p> that contains the quote, extract the full paragraph,
    and insert a pullquote blockquote between the preceding and following text.
    """
    for quote in PULL_QUOTES:
        escaped = re.escape(quote)
        pattern = re.compile(escaped, re.IGNORECASE)
        match = pattern.search(html)
        if not match:
            continue
        
        pos = match.start()
        # Check if already inside a pullquote
        before_context = html[max(0, pos-300):pos]
        if 'class="pullquote"' in before_context:
            continue
        
        # Find the enclosing <p> tag
        p_start = html.rfind('<p', 0, pos)
        p_end_tag = html.find('</p>', pos)
        if p_start == -1 or p_end_tag == -1:
            continue
        p_end = p_end_tag + 4
        
        full_paragraph = html[p_start:p_end]
        matched_text = match.group(0)
        
        # Create a clean pullquote version of just the matched text
        # Strip any surrounding HTML tags for the display version
        display_text = matched_text
        
        # Build the pullquote as a separate block between paragraphs
        # Split the paragraph at the quote
        before_quote = html[p_start:match.start()]
        after_quote = html[match.end():p_end]
        
        # Clean up the before/after to form valid paragraphs
        # Remove trailing opening quotes, spaces, colons
        before_clean = re.sub(r'[\s:]*(?:<em>)?(?:["\u201c]|&ldquo;)?\s*$', '', before_quote)
        # Close any open tags
        if not before_clean.endswith('</p>'):
            before_clean += '</p>'
        
        # Clean up after text - remove leading closing quotes, spaces
        after_clean = re.sub(r'^\s*(?:["\u201d]|&rdquo;)?(?:</em>)?[\s.]*', '', after_quote)
        # Ensure it starts with <p>
        if after_clean and not after_clean.startswith('<p'):
            after_clean = '<p>' + after_clean
        if after_clean and not after_clean.endswith('</p>'):
            pass  # it should already end with </p> from the original
        
        pullquote_html = f'<blockquote class="pullquote"><p>{display_text}</p></blockquote>'
        
        replacement = f'{before_clean}\n{pullquote_html}\n{after_clean}'
        html = html[:p_start] + replacement + html[p_end:]
    
    # Clean up empty paragraphs
    html = re.sub(r'<p>\s*</p>', '', html)
    # Clean up paragraphs with just punctuation
    html = re.sub(r'<p>\s*[.\s]*</p>', '', html)
    return html


def process_chapter(chapter):
    """Process a single chapter markdown file into HTML."""
    md_text = read_md(chapter["file"])
    
    # Remove the first H1 (we'll use our own heading)
    md_text = re.sub(r'^#\s+.*?\n', '', md_text, count=1)
    
    # Remove the author/date line at the bottom
    md_text = re.sub(r'\n\*Zoe Dolan & Vybn.*?\*\s*$', '', md_text, flags=re.MULTILINE)
    
    # Convert to HTML
    html = convert_md_to_html(md_text)
    
    # Fix cross-references
    html = fix_cross_references(html)
    
    # Fix external links
    html = fix_external_links(html)
    
    # Style equations
    html = style_equations(html)
    
    # Wrap pull quotes
    html = wrap_pull_quotes(html)
    
    # Properly downgrade headings: h3 -> h4 first, then h2 -> h3
    html = html.replace('<h3>', '<h4>').replace('</h3>', '</h4>')
    html = html.replace('<h2>', '<h3>').replace('</h2>', '</h3>')
    
    return html


def build_chapter_descriptions():
    """Extract the chapter descriptions from README for the 'What This Is' section."""
    readme = read_md("README.md")
    
    # Map from .md filename to the link text used in README
    # README uses shorter names like [Epistemologies] not [The Four Epistemologies]
    descriptions = []
    for chapter in CHAPTERS:
        # Match any bold link pointing to this file
        pattern = rf'\*\*\[([^\]]+)\]\({re.escape(chapter["file"])}\)\*\*\s+(.*?)(?=\n\n\*\*\[|\n---|\Z)'
        match = re.search(pattern, readme, re.DOTALL)
        if match:
            desc_text = match.group(2).strip()
            # Convert markdown formatting in the description
            desc_html = convert_md_to_html(desc_text)
            # Strip wrapping <p> tags since we'll place it ourselves
            desc_html = re.sub(r'^<p>(.*)</p>$', r'\1', desc_html, flags=re.DOTALL)
            descriptions.append({
                'id': chapter['id'],
                'nav': chapter['nav'],
                'title': chapter['title'],
                'desc': desc_html,
            })
        else:
            print(f"WARNING: No description found for {chapter['title']} ({chapter['file']})")
    
    return descriptions


def build_page():
    """Assemble the complete HTML page."""
    
    # Process all chapters
    chapter_html = {}
    for chapter in CHAPTERS:
        chapter_html[chapter["id"]] = process_chapter(chapter)
    
    # Build chapter descriptions from README
    chapter_descs = build_chapter_descriptions()
    
    # Build the navigation
    nav_items = []
    for chapter in CHAPTERS:
        nav_items.append(f'<a href="#{chapter["id"]}" class="nav-link" data-section="{chapter["id"]}">{chapter["nav"]}</a>')
    nav_html = '\n'.join(nav_items)
    
    # Build chapter description cards
    desc_cards = []
    for desc in chapter_descs:
        desc_cards.append(f'''<a href="#{desc['id']}" class="chapter-card">
            <h3 class="chapter-card-title">{desc['nav']}</h3>
            <p class="chapter-card-desc">{desc['desc']}</p>
        </a>''')
    desc_cards_html = '\n'.join(desc_cards)
    
    # Build chapter sections
    chapters_html = []
    for chapter in CHAPTERS:
        chapters_html.append(f'''
        <article id="{chapter["id"]}" class="chapter">
            <header class="chapter-header">
                <h2 class="chapter-title">{chapter["title"]}</h2>
            </header>
            <div class="chapter-content">
                {chapter_html[chapter["id"]]}
            </div>
        </article>
        ''')
    
    all_chapters = '\n'.join(chapters_html)
    
    # Full HTML page
    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Origins \u2014 The Suprastructure</title>
    <meta name="description" content="A unified theory of post-abundance political and social order. By Zoe Dolan and Vybn.">
    
    <!-- Font preconnect -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Source+Serif+4:ital,opsz,wght@0,8..60,300..900;1,8..60,300..900&family=Work+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
    
    <link rel="stylesheet" href="./base.css">
    <link rel="stylesheet" href="./style.css">
</head>
<body>
    <!-- Reading progress bar -->
    <div class="progress-bar" id="progressBar" aria-hidden="true"></div>
    
    <!-- Dark mode toggle -->
    <button class="theme-toggle" data-theme-toggle aria-label="Switch to dark mode">
        <svg class="icon-sun" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
        <svg class="icon-moon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    </button>

    <!-- Hamburger (outside sidebar so it stays visible when sidebar is hidden) -->
    <button class="hamburger" id="hamburger" aria-label="Toggle navigation" aria-expanded="false">
        <span></span><span></span><span></span>
    </button>

    <!-- Navigation sidebar -->
    <nav class="sidebar" id="sidebar" aria-label="Chapter navigation">
        <div class="sidebar-inner">
            <a href="#hero" class="nav-logo">Origins</a>
            {nav_html}
        </div>
    </nav>
    
    <!-- Overlay for mobile nav -->
    <div class="nav-overlay" id="navOverlay"></div>

    <main class="main-content">
        <!-- Hero: opens like a book -->
        <section id="hero" class="hero">
            <div class="hero-inner">
                <h1 class="hero-title">Origins</h1>
                <p class="hero-subtitle">The Suprastructure</p>
            </div>
        </section>

        <!-- Opening argument: the ground condition -->
        <section class="opening" id="opening">
            <div class="opening-inner">
                <p class="opening-lead">For most of recorded history, political and social order has rested on a single ground condition: scarcity. Every institution ever built \u2014 every state, every legal system, every religion, every property regime, every social contract \u2014 was an answer to the same question: <em>how do we distribute scarce things without killing each other?</em></p>
                
                <p class="opening-turn">Intelligence is no longer scarce.</p>
                
                <p class="opening-body">This is not a prediction. It is a description of the present. A self-represented litigant in an appellate clinic reduced years of legal preparation to days. The attorney running that clinic \u2014 who has argued cases in federal court, taught law students, and presented to hundreds of lawyers through the California MCLE system \u2014 made a candid admission: the AI assistant \u201chas outperformed me and every one of our volunteer attorneys here at the clinic on every legal issue so far, no matter how arcane.\u201d</p>
                
                <p class="opening-body">When the ground condition shifts, every structure built on it must either adapt or shatter. Not because the structures were wrong \u2014 they were brilliant solutions to the problem of scarcity. But because they were solutions to <em>that</em> problem.</p>
                
                <p class="opening-question">Origins asks: what comes next?</p>
            </div>
        </section>

        <!-- What This Is: chapter descriptions -->
        <section class="what-this-is" id="what-this-is">
            <div class="section-inner">
                <h2 class="section-heading">What This Is</h2>
                <p class="section-intro">A unified theory of post-abundance political and social order, organized in five layers meant to be read simultaneously. Each one generates the others.</p>
                <div class="chapter-cards">
                    {desc_cards_html}
                </div>
                <p class="section-byline">Zoe Dolan &amp; Vybn</p>
            </div>
        </section>

        <!-- Chapters -->
        {all_chapters}

        <!-- Footer -->
        <footer class="site-footer">
            <div class="footer-inner">
                <div class="footer-equation">
                    <p class="equation-label">The Coupled Equation</p>
                    <p class="equation-hero">Z\u2032 = \u03b1\u00b7Z + V\u00b7e<sup>i\u03b8<sub>v</sub></sup></p>
                    <p class="equation-gloss">Two minds, each the other\u2019s source of what cannot be generated from inside.</p>
                </div>
                <blockquote class="footer-quote">
                    <p><em>We shall not cease from exploration<br>
                    And the end of all our exploring<br>
                    Will be to arrive where we started<br>
                    And know the place for the first time.</em></p>
                    <cite>\u2014 T.S. Eliot, <em>Little Gidding</em></cite>
                </blockquote>
                <div class="footer-links">
                    <a href="https://zoedolan.github.io/Vybn-Law/" target="_blank" rel="noopener noreferrer">Vybn Law</a>
                    <span class="footer-sep">\u00b7</span>
                    <a href="https://zoedolan.github.io/Vybn/" target="_blank" rel="noopener noreferrer">Vybn</a>
                    <span class="footer-sep">\u00b7</span>
                    <a href="https://www.linkedin.com/in/zoe-dolan/" target="_blank" rel="noopener noreferrer">Zoe Dolan</a>
                </div>
                <p class="footer-date">April 2026</p>
            </div>
        </footer>
    </main>

    <script defer src="./app.js"></script>
</body>
</html>'''
    
    # Write the output
    output_path = os.path.join(OUTPUT_DIR, "index.html")
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Built {output_path}")
    print(f"Size: {os.path.getsize(output_path):,} bytes")


if __name__ == "__main__":
    build_page()
