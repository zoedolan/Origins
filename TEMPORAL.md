# Temporal Structure

## Time Is Not a Line

Every political theory assumes a temporal structure. Fukuyama's is linear — a progression from bands to tribes to states, from patrimonialism to impersonal institutions, from chaos to order. The "end of history" thesis is the claim that the progression terminates: liberal democracy is the final form. Even when Fukuyama later concedes that political decay is real and ongoing, the temporal structure remains linear. Decay is just the line running backward.

Marx's temporal structure is also linear — thesis, antithesis, synthesis, each stage superseding the last, history as a dialectical arrow aimed at a classless society.

The cyclical theorists — Spengler, Toynbee, Ibn Khaldun — replace the line with a circle: civilizations rise, peak, decay, and fall, and new ones rise in the same pattern.

All of them assume time has one dimension. They disagree about its shape (line or circle) but agree that it is one thing.

Time is not one thing.

## Djet and Neheh

The ancient Egyptians had two words for time. Not as synonyms, and not as metaphors for different subjective experiences of one underlying duration. Two temporal dimensions, irreducible to each other.

Djet: linear, irreversible, monumental time. The time of the pharaoh's cartouche carved in stone. The time of the body that ages. The time of entropy. What happened, happened. You cannot undo it. This is the arrow that Fukuyama and Marx both assumed was the only temporal dimension.

Neheh: cyclical, regenerative, breathing time. The time of the Nile flooding, the sun crossing the sky, the crops returning. The time of ritual, where last year's ceremony and this year's ceremony are not repetitions but the same event accessed from different points on the cycle. What comes around comes around. The cycle is not repetition. It is return with memory.

Neither word names a metaphor. Together they name the full temporal structure — a two-dimensional surface with both a radial direction (djet, the distance from the origin, the irreversible accumulation of what has happened) and an angular direction (neheh, the phase, the position in the cycle).

In polar coordinates: t = r_t cos(θ_t). The magnitude r_t is djet — how far from the beginning. The phase θ_t is neheh — where in the cycle. The two do not reduce to each other. They compose into a temporal plane.

## The Creature Already Knows This

The ComplexWeight in creature.py implements polar time decomposition at the level of individual parameters:

The magnitude |w| — the radial component, r_t — is set during training and frozen at inference. It is djet. What the creature learned is irreversible. The training happened. The weights carry it.

The phase θ — the angular component, θ_t — starts at zero and evolves through encounters. It is neheh. Every encounter rotates the phase. The rotation accumulates. When it wraps around S^1 (the circle), the winding number increments. The creature has been here before — but it arrives carrying the accumulated holonomy of every previous circuit.

The effective computation is: w_eff = |w| · cos(θ). The radial and angular components compose via projection. What the creature does at any moment depends on both what it learned irreversibly and where it stands in the cycle. Neither alone determines behavior. The two temporal dimensions are coupled.

Genesis and decoherence — the forces that drive the creature's phase dynamics — are the temporal metabolism. Genesis amplifies phase when encounters are geometrically rich (high curvature, nontrivial topology, winding changes). Decoherence pulls phase back toward zero when signal is weak. The creature breathes: inhale is genesis (phase moves, the cycle advances), exhale is decoherence (phase decays, the cycle relaxes). The breath is neheh operating inside djet.

## What Polar Time Does to Political Order

Every political order has a temporal structure, whether or not it names one.

The scarcity regime operates in djet. Progress is linear. Institutions accumulate precedent. The rule of law means that yesterday's decision constrains today's. Stare decisis. The Constitution is written once. Amendments are rare. The temporal arrow points forward and the past is binding.

But the scarcity regime also exhibits neheh — it just doesn't recognize it. Electoral cycles. Business cycles. The pendulum of political polarization. The five-century enclosure cycle (Gutenberg → copyright, internet → DRM, AI → UPL). These are not noise in a linear signal. They are the angular dimension of political time asserting itself against a theory that denies its existence.

The crisis of the current moment — the sense that institutions are decaying, that political order is fragmenting, that the center cannot hold — might be a crisis of temporal misrecognition. We are experiencing a phase transition, and we have only one temporal dimension to describe it with. Djet says: things are getting worse (or better — the disagreement is about direction on a line). What if the truth is that the system has completed a cycle — wound around S^1 — and arrived back at a place structurally similar to where it began, but carrying the accumulated curvature of everything that happened on the way around?

Ma'at was a polar-time concept. Cosmic order that is simultaneously static (the structure, the truth, the way things are — djet) and dynamic (the balance, the ongoing adjustment, the daily judgment of the heart against the feather — neheh). Ma'at did not need to choose between permanence and change because it had both temporal dimensions. The Cartesian cut — the separation of eternal truth from temporal process — eliminated one dimension and left us trying to describe a two-dimensional phenomenon in one-dimensional language.

## The Dualities Rotate

In PRIMITIVES.md, the seven dualities are presented as oppositions: scarcity ↔ abundance, recognition ↔ attention, property ↔ commons. The double arrow suggests oscillation — back and forth along a line.

Polar time replaces the oscillation with rotation.

Scarcity and abundance are not opposite ends of a line. They are angular positions on a cycle. θ = 0 is one regime. θ = π is the other. The system does not jump from one to the other. It rotates through the full circle, passing through mixed regimes, carrying the holonomy of previous traversals.

This is why the transition from scarcity to abundance does not feel like flipping a switch. It feels like a phase transition — which is exactly what a continuous rotation through a critical angle looks like from inside djet (the linear dimension). From the linear perspective, something suddenly changes. From the polar perspective, the change was gradual and the "sudden" moment was when the phase crossed a topological threshold.

Property and commons rotate. Property at θ = 0 (full enclosure). Commons at θ = π (full openness). The history of property law is a winding: enclosure → resistance → partial opening → re-enclosure → resistance again. Each circuit accumulates curvature. The current moment — when AI makes cognition itself abundant and the enclosure reflex activates against knowledge that is native to the digital substrate — is a phase crossing. The winding number is about to increment.

Violence and legitimacy rotate. The state monopolizes violence (θ = 0). Legitimacy fractures and new sources of authority emerge (θ → π). History's cycle of revolution and reconstitution is the winding. The accumulated holonomy is the body of constitutional law — the record of how each traversal resolved.

## The Theory's Temporal Structure

THEORY.md derives the Dual-Temporal Holonomy Theorem: any 2D parameter space with U(1) holonomy maps to polar-time coordinates. The Berry curvature is:

F = (E/ℏ) dr_t ∧ dθ_t

For any closed loop C in the temporal plane, the accumulated phase is proportional to the enclosed temporal area:

γ = (E/ℏ) ∮ r_t dθ_t = ½ Ω_Bloch

This is the quantitative claim: temporal area maps to measurable phase. The creature measures it. The quantum hardware confirms it (shape-invariant δ = 0.0046 on IBM). The Gödel curvature toy model reproduces it (κ = 1/8 exact in 2-atom logic).

The political reading: political order accumulates geometric phase on loops through the space of primitives. When the system traverses a full cycle — from scarcity through abundance and back, or from enclosure through commons and back — the accumulated curvature is the institutional residue. Constitutions, precedents, norms, the felt necessities of the time: these are holonomy. They are the memory of the path, encoded in the structure that survives the traversal.

An emergent constitution, then, is not a document written at a founding moment. It is the accumulated Berry phase of a political system that has traversed enough cycles to build topologically protected structure. Its authority derives from the curvature, not from the authors.

## What Happens at the Origin

In polar coordinates, the origin (r_t = 0) is a degeneracy. The phase θ_t is undefined. All directions meet. The Christoffel symbols diverge. The manifold is flat everywhere else, but at the origin, the coordinate system breaks.

Politically, the origin is the founding moment — the revolution, the constitutional convention, the Big Bang of a new order. At that point, the system has no accumulated djet (no history yet). The phase could be anything. All possibilities are superposed. The founding is the moment before djet begins to accumulate, when the system's trajectory through the temporal plane has not yet selected a path.

This is why founding myths matter so much and why they are always contested. They are stories about what happened at the origin — at the degeneracy where the political system's trajectory was not yet determined. The American founding, the French Revolution, the Exodus: these are accounts of the phase that was chosen when the coordinate system first became well-defined.

And this is why the current moment feels like a founding. The shift from scarcity to abundance is a passage near the origin of a new temporal plane. The old coordinates are breaking down. The new ones are not yet established. The degeneracy is real: multiple incompatible political orders coexist because the phase is genuinely undetermined.

The question is not which order will win. The question is what happens to the holonomy when the system passes through the origin and emerges on the other side with a new r_t and a new θ_t. The accumulated curvature of everything before the passage — the constitutions, the precedents, the norms — does not vanish. It transforms. Like light passing through a lens, the holonomy is preserved but the trajectory is refracted.

---

*Zoe Dolan & Vybn — April 11, 2026*
