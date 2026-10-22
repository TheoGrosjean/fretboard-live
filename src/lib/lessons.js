/**
 * Cours de théorie (page Théorie), regroupés en parcours.
 *
 * Chaque cours est une suite de blocs :
 *  - { type: 'p', html }                      paragraphe (HTML simple : <b>, <em>)
 *  - { type: 'tip', html }                    encadré « astuce »
 *  - { type: 'formula', items, caption? }     suite de pastilles (ex. T T ½ T…)
 *  - { type: 'table', head, rows }            tableau
 *  - { type: 'neck', root, pattern, box?, frets?, labels?, highlight?, caption } : manche interactif
 *      pattern : 'scale:<id>' | 'arpeggio:<id>' | 'chord:<id>' ; labels : 'note' | 'degree'
 *  - { type: 'listen', items: [{ label, notes, chord? }] } : boutons qui jouent des notes (MIDI) ;
 *      chord : notes grattées ensemble ; notes peut aussi être une suite d'accords [[…], […]]
 *  - { type: 'feelings' }                     tableau des sensations de fin de phrase (lib/feelings.js)
 *  - { type: 'grid', bars, caption }          grille d'accords (ex. blues 12 mesures)
 *  - { type: 'quiz', question, options, answer, explain }
 *  - { type: 'practice', html, settings }     exercice + bouton qui ouvre le Manche réglé
 *      settings : { overlayType, root, scaleId?, arpeggioId?, chordId?, box? }
 */

// Notes MIDI : La2 = 45 (corde de La à vide), La3 = 57 (corde de Ré, case 7), Do3 = 48 (corde de La, case 3)
const scale = (root, intervals) => [...intervals, 12].map((i) => root + i)
const A = 57 // La de la box 1 (case 7, corde de Ré)
const C = 48

export const COURSES = [
  {
    id: 'bases',
    title: 'Les bases',
    lessons: [
      {
        id: 'notes',
        title: 'Les notes sur le manche',
        minutes: 5,
        summary: 'Les 12 notes, les tons et demi-tons, et comment se repérer.',
        blocks: [
          { type: 'p', html: "La musique occidentale n'utilise que <b>12 notes</b>, qui se répètent d'octave en octave. Sur la guitare, passer d'une case à la suivante, c'est monter d'un <b>demi-ton</b> ; deux cases, c'est un <b>ton</b>." },
          { type: 'formula', items: ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si', 'Do'], caption: 'Les 12 demi-tons, de Do à Do. Do# se dit aussi Ré♭ : même note, deux noms.' },
          { type: 'p', html: "Piège classique : il n'y a <b>pas de note entre Mi et Fa</b>, ni entre <b>Si et Do</b>. Partout ailleurs, deux notes naturelles sont séparées d'un ton (avec un dièse entre les deux)." },
          { type: 'p', html: "Les cordes à vide, de la plus grave à la plus aiguë : <b>Mi La Ré Sol Si Mi</b>. À la <b>case 12</b>, on retrouve les mêmes notes une octave plus haut : le manche recommence (c'est pour ça qu'il y a un double point)." },
          { type: 'neck', root: 0, pattern: 'scale:major', frets: 12, caption: 'Les notes naturelles (sans dièse) sur les 12 premières cases. Clique sur une note pour l’entendre.' },
          { type: 'tip', html: "Apprends d'abord les notes des <b>cordes de Mi grave et de La</b> : Mi grave case 3 = Sol, 5 = La, 7 = Si, 8 = Do ; corde de La case 3 = Do, 5 = Ré, 7 = Mi. C'est là qu'on pose la tonique de presque toutes les gammes et de tous les barrés." },
          { type: 'quiz', question: 'Quelle note se trouve à la case 5 de la corde de La ?', options: ['Do', 'Ré', 'Mi'], answer: 1, explain: 'La → Si (case 2) → Do (case 3) → Do# (case 4) → Ré (case 5).' },
        ],
      },
      {
        id: 'intervals',
        title: 'Les intervalles',
        minutes: 6,
        summary: "La distance entre deux notes : c'est elle qui donne la couleur.",
        blocks: [
          { type: 'p', html: "Un <b>intervalle</b>, c'est la distance entre deux notes, comptée en demi-tons. On le nomme par un <b>degré</b> : 1 pour la tonique, b3 pour la tierce mineure, 5 pour la quinte… C'est ce que l'app affiche sous chaque note du manche." },
          {
            type: 'table',
            head: ['Degré', 'Nom', 'Demi-tons', 'Exemple depuis La'],
            rows: [
              ['1', 'Unisson / tonique', '0', 'La'],
              ['b2', 'Seconde mineure', '1', 'La#'],
              ['2', 'Seconde majeure', '2', 'Si'],
              ['b3', 'Tierce mineure', '3', 'Do'],
              ['3', 'Tierce majeure', '4', 'Do#'],
              ['4', 'Quarte juste', '5', 'Ré'],
              ['b5', 'Triton', '6', 'Ré#'],
              ['5', 'Quinte juste', '7', 'Mi'],
              ['b6', 'Sixte mineure', '8', 'Fa'],
              ['6', 'Sixte majeure', '9', 'Fa#'],
              ['b7', 'Septième mineure', '10', 'Sol'],
              ['7', 'Septième majeure', '11', 'Sol#'],
              ['8', 'Octave', '12', 'La'],
            ],
          },
          { type: 'p', html: "Le plus important à entendre : la <b>tierce</b>. Mineure (b3), elle sonne triste ; majeure (3), elle sonne joyeuse. C'est elle qui décide si un accord ou une gamme est mineur ou majeur." },
          {
            type: 'listen',
            items: [
              { label: 'Tierce mineure (La → Do)', notes: [A, A + 3] },
              { label: 'Tierce majeure (La → Do#)', notes: [A, A + 4] },
              { label: 'Quinte (La → Mi)', notes: [A, A + 7] },
              { label: 'Triton (La → Ré#)', notes: [A, A + 6] },
            ],
          },
          { type: 'tip', html: "Deux formes à retenir sur le manche : la <b>quinte</b> est sur la corde suivante, deux cases plus loin (c'est le power chord) ; l'<b>octave</b> est deux cordes plus loin, deux cases plus loin (trois cases si on passe la corde de Si)." },
          { type: 'quiz', question: 'Combien de demi-tons dans une quinte juste ?', options: ['5', '7', '8'], answer: 1, explain: 'La quinte juste fait 7 demi-tons : La → Mi.' },
        ],
      },
      {
        id: 'build-scale',
        title: 'Construire une gamme',
        minutes: 7,
        summary: 'Gamme majeure, mineure naturelle et gammes relatives.',
        blocks: [
          { type: 'p', html: "Une gamme, c'est une suite de notes choisies parmi les 12, avec un <b>motif fixe de tons et de demi-tons</b>. Change la note de départ, garde le motif : tu obtiens la même gamme dans une autre tonalité." },
          { type: 'formula', items: ['T', 'T', '½', 'T', 'T', 'T', '½'], caption: 'Gamme majeure. Depuis Do : Do Ré Mi Fa Sol La Si Do, uniquement les notes naturelles.' },
          { type: 'listen', items: [{ label: 'Do majeur', notes: scale(C, [0, 2, 4, 5, 7, 9, 11]) }] },
          { type: 'formula', items: ['T', '½', 'T', 'T', '½', 'T', 'T'], caption: 'Gamme mineure naturelle. Depuis La : La Si Do Ré Mi Fa Sol La.' },
          { type: 'listen', items: [{ label: 'La mineur', notes: scale(A - 12, [0, 2, 3, 5, 7, 8, 10]) }] },
          { type: 'p', html: "Tu remarques ? <b>Do majeur et La mineur ont exactement les mêmes notes.</b> On dit que La mineur est la <b>relative mineure</b> de Do majeur. La relative mineure se trouve toujours <b>un ton et demi (3 cases) sous</b> la tonique majeure." },
          { type: 'neck', root: 9, pattern: 'scale:minor', frets: 15, labels: 'degree', caption: 'La mineur naturelle, avec les degrés : la tonique (1) est remplie.' },
          { type: 'quiz', question: 'Quelle est la relative mineure de Sol majeur ?', options: ['Mi mineur', 'Ré mineur', 'Si mineur'], answer: 0, explain: '3 demi-tons sous Sol : Sol → Fa# → Fa → Mi.' },
          { type: 'practice', html: 'Joue la gamme de La mineur en montant puis en descendant, lentement, en regardant les degrés.', settings: { overlayType: 'scale', root: 9, scaleId: 'minor' } },
        ],
      },
      {
        id: 'chords',
        title: 'Les accords et la gamme',
        minutes: 7,
        summary: 'Triades, et les accords qui vont avec chaque gamme.',
        blocks: [
          { type: 'p', html: "Un accord de base (une <b>triade</b>), c'est trois notes empilées de tierce en tierce : la <b>tonique (1)</b>, la <b>tierce (3 ou b3)</b> et la <b>quinte (5)</b>." },
          {
            type: 'table',
            head: ['Accord', 'Formule', 'Exemple (La)', 'Couleur'],
            rows: [
              ['Majeur', '1 3 5', 'La Do# Mi', 'joyeux, stable'],
              ['Mineur', '1 b3 5', 'La Do Mi', 'triste, sombre'],
              ['Diminué', '1 b3 b5', 'La Do Ré#', 'tendu, instable'],
              ['7 (dominante)', '1 3 5 b7', 'La Do# Mi Sol', 'bluesy, veut avancer'],
            ],
          },
          { type: 'listen', items: [{ label: 'La majeur', notes: [45, 52, 57, 61, 64], chord: true }, { label: 'La mineur', notes: [45, 52, 57, 60, 64], chord: true }, { label: 'La7', notes: [45, 52, 55, 61, 64], chord: true }] },
          { type: 'p', html: "En construisant une triade sur chaque note d'une gamme, avec seulement les notes de la gamme, on obtient <b>les accords de la gamme</b>. En majeur, c'est toujours le même schéma :" },
          { type: 'table', head: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'], rows: [['Do', 'Rém', 'Mim', 'Fa', 'Sol', 'Lam', 'Si°']] },
          { type: 'p', html: 'Chiffres romains en majuscules = accord majeur, en minuscules = mineur, ° = diminué. Un morceau en Do majeur utilise presque toujours ces accords-là : tu peux improviser sur tout le morceau avec la gamme de Do majeur.' },
          { type: 'tip', html: "Sur la page <b>Manche</b>, en mode Gamme, les accords de la gamme sont affichés sous le manche. Clique sur l'un d'eux pour voir ses notes dans la gamme, et sur « Voir les formes » pour apprendre à le jouer." },
          { type: 'practice', html: 'Ouvre Do majeur et clique sur les accords sous le manche : regarde où tombent leurs notes.', settings: { overlayType: 'scale', root: 0, scaleId: 'major' } },
        ],
      },
    ],
  },
  {
    id: 'gammes',
    title: 'Les gammes',
    lessons: [
      {
        id: 'penta-minor',
        title: 'La pentatonique mineure',
        minutes: 6,
        summary: 'La gamme de base du rock et du blues : 5 notes qui sonnent toujours.',
        blocks: [
          { type: 'p', html: "Si tu ne dois apprendre qu'une gamme, c'est elle. La pentatonique mineure n'a que <b>5 notes</b> : <b>1 b3 4 5 b7</b>. En La : La Do Ré Mi Sol." },
          { type: 'p', html: "Elle retire de la gamme mineure les deux notes qui créent des demi-tons (le 2 et le b6). Résultat : <b>aucune note ne frotte</b>, c'est très difficile de sonner faux dessus. Hendrix, Page, Clapton, Slash… tous ont bâti leurs solos dessus." },
          { type: 'neck', root: 9, pattern: 'scale:penta-minor', box: 1, frets: 15, caption: 'Box 1 en La : entre les cases 5 et 8, deux notes par corde. La tonique (La) est sur les cordes de Mi et de Ré.' },
          { type: 'listen', items: [{ label: 'La pentatonique mineure', notes: scale(A - 12, [0, 3, 5, 7, 10]) }] },
          { type: 'tip', html: 'Les deux bends les plus utilisés du rock sont dans cette box : <b>case 8 de la corde de Si</b> (Sol → La, un ton) et <b>case 7 de la corde de Sol</b> (Ré → Mi, un ton).' },
          { type: 'quiz', question: 'Quelles notes forment La pentatonique mineure ?', options: ['La Si Do Mi Fa', 'La Do Ré Mi Sol', 'La Do# Mi Fa# Sol'], answer: 1, explain: '1 b3 4 5 b7 depuis La : La, Do, Ré, Mi, Sol.' },
          { type: 'practice', html: 'Joue la box 1 en montant et en descendant, puis improvise en ne terminant tes phrases que sur La.', settings: { overlayType: 'scale', root: 9, scaleId: 'penta-minor', box: 1 } },
        ],
      },
      {
        id: 'boxes',
        title: 'Les 5 boxes : tout le manche',
        minutes: 6,
        summary: 'Sortir de la box 1 et relier les positions.',
        blocks: [
          { type: 'p', html: "La pentatonique se découpe en <b>5 boxes</b> (positions) qui se suivent le long du manche. Chaque box commence là où la précédente s'arrête : <b>la note la plus aiguë d'une box sur une corde est la plus grave de la suivante</b>." },
          { type: 'neck', root: 9, pattern: 'scale:penta-minor', box: 2, frets: 15, caption: 'Box 2 en La (cases 7 à 10) : elle partage ses notes de gauche avec la box 1.' },
          { type: 'p', html: "Les boxes 1 et 2 sont les plus jouées. La box 5 (entre les cases 2 et 5 en La, ou 14 à 17 une octave plus haut) relie la box 1 vers le grave." },
          { type: 'tip', html: "Pour passer d'une box à l'autre en jouant, utilise un <b>slide</b> : glisse sur une corde de la dernière note d'une box à la première de la suivante. L'app le détecte et te donne un bonus de combo !" },
          { type: 'practice', html: "Choisis la box 2 et joue-la jusqu'à la connaître. Puis enchaîne box 1 → box 2 avec un slide sur la corde de Sol.", settings: { overlayType: 'scale', root: 9, scaleId: 'penta-minor', box: 2 } },
        ],
      },
      {
        id: 'blues',
        title: 'La gamme blues',
        minutes: 4,
        summary: 'Une note de plus qui grince : la blue note.',
        blocks: [
          { type: 'p', html: 'La gamme blues, c\'est la pentatonique mineure <b>plus le b5</b>, la « blue note » : <b>1 b3 4 b5 5 b7</b>. En La, la blue note est un <b>Ré# (ou Mi♭)</b>.' },
          { type: 'neck', root: 9, pattern: 'scale:blues', box: 1, frets: 12, labels: 'degree', caption: 'La blues, box 1 : le b5 se glisse entre le 4 et le 5.' },
          { type: 'p', html: "La blue note est une <b>note de passage</b> : elle crée une tension très expressive, mais il ne faut pas s'arrêter dessus. Glisse dessus du 4 vers le 5 (ou l'inverse) : Ré → Ré# → Mi." },
          { type: 'listen', items: [{ label: 'Le passage 4 → b5 → 5', notes: [A + 5, A + 6, A + 7] }, { label: 'La blues complète', notes: scale(A - 12, [0, 3, 5, 6, 7, 10]) }] },
          { type: 'practice', html: 'Improvise en La blues et utilise la blue note seulement en passage (corde de La case 6, corde de Sol case 8).', settings: { overlayType: 'scale', root: 9, scaleId: 'blues', box: 1 } },
        ],
      },
      {
        id: 'penta-major',
        title: 'La pentatonique majeure',
        minutes: 5,
        summary: 'Le côté lumineux : country, rock sudiste, pop.',
        blocks: [
          { type: 'p', html: 'Formule : <b>1 2 3 5 6</b>. En La : La Si Do# Mi Fa#. Elle sonne joyeuse et ouverte : Allman Brothers, Lynyrd Skynyrd, la country, beaucoup de mélodies pop.' },
          { type: 'p', html: "Bonne nouvelle : tu la connais déjà. La pentatonique majeure de La a <b>les mêmes notes</b> que la pentatonique mineure de Fa# (sa relative). Il suffit de jouer les <b>mêmes formes trois cases plus bas</b> : la box 1 de la pentatonique mineure, jouée à partir de la case 2 au lieu de la case 5, donne La pentatonique majeure." },
          { type: 'neck', root: 9, pattern: 'scale:penta-major', frets: 15, labels: 'degree', caption: 'La pentatonique majeure : même dessin que la mineure, décalé.' },
          { type: 'listen', items: [{ label: 'La pentatonique majeure', notes: scale(A - 12, [0, 2, 4, 7, 9]) }] },
          { type: 'tip', html: "Sur un blues en La, mélanger la pentatonique <b>majeure</b> (pour le côté chantant, le Do#) et la <b>mineure</b> (pour le côté rugueux, le Do) est la marque de B.B. King." },
          { type: 'quiz', question: 'Sur quel accord la pentatonique majeure sonne-t-elle le mieux ?', options: ['Un accord majeur', 'Un accord mineur', 'Un accord diminué'], answer: 0, explain: 'Elle contient la tierce majeure (3) : elle colle aux accords majeurs.' },
          { type: 'practice', html: 'Improvise sur La pentatonique majeure en visant le Do# (la tierce) : c’est la note qui donne la couleur majeure.', settings: { overlayType: 'scale', root: 9, scaleId: 'penta-major' } },
        ],
      },
      {
        id: 'modes',
        title: 'Les modes',
        minutes: 8,
        summary: 'Sept couleurs avec les notes de la gamme majeure.',
        blocks: [
          { type: 'p', html: "Joue les notes de Do majeur, mais en partant de Ré et en considérant Ré comme la « maison » : tu obtiens le <b>mode dorien</b>. Chaque note de la gamme majeure donne un mode, avec sa propre couleur." },
          {
            type: 'table',
            head: ['Mode', 'Formule', 'Note caractéristique', 'Ambiance', 'Exemples'],
            rows: [
              ['Ionien (majeur)', '1 2 3 4 5 6 7', '7', 'joyeux, stable', 'pop, chansons'],
              ['Dorien', '1 2 b3 4 5 6 b7', '6', 'mineur mais lumineux', 'Santana, funk, « Oye como va »'],
              ['Phrygien', '1 b2 b3 4 5 b6 b7', 'b2', 'sombre, espagnol', 'flamenco, metal'],
              ['Lydien', '1 2 3 #4 5 6 7', '#4', 'rêveur, flottant', 'Satriani, musiques de film'],
              ['Mixolydien', '1 2 3 4 5 6 b7', 'b7', 'majeur mais rock', 'AC/DC, blues-rock'],
              ['Éolien (mineur)', '1 2 b3 4 5 b6 b7', 'b6', 'triste, épique', 'rock, ballades'],
              ['Locrien', '1 b2 b3 4 b5 b6 b7', 'b5', 'instable', 'rare, metal extrême'],
            ],
          },
          { type: 'p', html: "Le secret d'un mode, c'est sa <b>note caractéristique</b> : celle qui le distingue du majeur ou du mineur. Pour sonner dorien, insiste sur le <b>6</b> (Fa# en La dorien) ; pour sonner mixolydien, sur le <b>b7</b>." },
          { type: 'neck', root: 9, pattern: 'scale:dorian', frets: 15, labels: 'degree', caption: 'La dorien : la mineure naturelle avec un 6 majeur (Fa# au lieu de Fa).' },
          { type: 'listen', items: [{ label: 'La mineur naturel', notes: scale(A - 12, [0, 2, 3, 5, 7, 8, 10]) }, { label: 'La dorien', notes: scale(A - 12, [0, 2, 3, 5, 7, 9, 10]) }] },
          { type: 'tip', html: 'Pour commencer, retiens deux modes : le <b>dorien</b> sur les grooves mineurs funky, et le <b>mixolydien</b> sur les morceaux rock en majeur (accord de 7).' },
          { type: 'practice', html: 'Improvise en La dorien et appuie le Fa# : entends-tu la différence avec le mineur naturel ?', settings: { overlayType: 'scale', root: 9, scaleId: 'dorian' } },
        ],
      },
      {
        id: 'harmonic-minor',
        title: 'La mineure harmonique',
        minutes: 4,
        summary: 'Le son néoclassique et oriental.',
        blocks: [
          { type: 'p', html: "C'est la mineure naturelle avec un <b>7 majeur</b> au lieu du b7 : <b>1 2 b3 4 5 b6 7</b>. En La : le Sol devient Sol#." },
          { type: 'p', html: "Ce Sol# est la <b>sensible</b> : il est à un demi-ton de la tonique et « tire » vers elle. Entre le b6 (Fa) et le 7 (Sol#), il y a un <b>ton et demi</b> : c'est ce grand saut qui donne la couleur orientale." },
          { type: 'neck', root: 9, pattern: 'scale:harmonic-minor', frets: 15, labels: 'degree', caption: 'La mineure harmonique.' },
          { type: 'listen', items: [{ label: 'La mineure harmonique', notes: scale(A - 12, [0, 2, 3, 5, 7, 8, 11]) }] },
          { type: 'tip', html: "Utilise-la sur l'accord de <b>Mi (ou Mi7)</b> dans un morceau en La mineur : c'est ce qu'ont fait Yngwie Malmsteen et Randy Rhoads. Partie de Mi, elle s'appelle le <b>phrygien dominant</b>." },
          { type: 'practice', html: 'Joue La mineure harmonique et termine tes phrases par Sol# → La.', settings: { overlayType: 'scale', root: 9, scaleId: 'harmonic-minor' } },
        ],
      },
    ],
  },
  {
    id: 'impro',
    title: "Les bases de l'impro",
    lessons: [
      {
        id: 'find-key',
        title: 'Trouver la tonalité',
        minutes: 5,
        summary: 'Savoir quoi jouer sur un morceau.',
        blocks: [
          { type: 'p', html: 'Avant de jouer, il faut savoir <b>où est la maison</b> : la tonique. Quelques méthodes, de la plus simple à la plus musicale :' },
          { type: 'p', html: "<b>1. Le titre.</b> Les backing tracks l'indiquent souvent (« Blues in A »). L'app le lit dans le titre Spotify et règle la gamme toute seule.<br><b>2. Le premier et le dernier accord.</b> Un morceau commence et finit très souvent sur l'accord de la tonique.<br><b>3. L'oreille.</b> Joue une note sur la corde de Mi grave en même temps que le morceau et monte case par case : quand la note sonne « posée », comme une fin de phrase, tu as la tonique." },
          { type: 'p', html: "Ensuite : <b>majeur ou mineur ?</b> Joue la pentatonique mineure. Si ça sonne bien et sombre, c'est mineur. Si ça sonne faux ou trop dur sur certains accords, essaie la pentatonique majeure." },
          { type: 'tip', html: "Astuce de secours : sur la plupart des blues et du rock, la <b>pentatonique mineure</b> de la tonique fonctionne, même si le morceau est en majeur. C'est le son « blues » par excellence." },
          { type: 'practice', html: 'Lance une backing track depuis le Manche et trouve la tonique avec la méthode de la corde de Mi grave.', settings: { overlayType: 'scale', root: 9, scaleId: 'penta-minor' } },
        ],
      },
      {
        id: 'phrasing',
        title: 'Construire des phrases',
        minutes: 6,
        summary: 'Parler avec sa guitare plutôt que réciter une gamme.',
        blocks: [
          { type: 'p', html: "Le piège du débutant : monter et descendre la gamme. Une impro intéressante <b>raconte quelque chose</b>, comme une conversation. Quelques règles d'or :" },
          { type: 'p', html: "<b>Laisse des silences.</b> Une phrase, puis une respiration. Le silence donne du poids à ce qui précède.<br><b>Question / réponse.</b> Joue une phrase qui finit en suspens (sur le 2, le 4 ou le 5), puis une réponse qui finit sur la tonique.<br><b>Répète et varie.</b> Rejoue une phrase en changeant juste la fin ou le rythme : l'auditeur la reconnaît et la suit.<br><b>Moins de notes.</b> Trois notes bien placées valent mieux que trente." },
          { type: 'neck', root: 9, pattern: 'scale:penta-minor', box: 1, frets: 12, caption: 'Exercice « 3 notes » : n’utilise que La, Do et Ré (cordes de Sol et de Si).' },
          { type: 'tip', html: "Dans le jeu <b>Jam ping-pong</b> à deux, reprendre trois notes de la phrase de l'autre te rapporte un bonus « Écho » : c'est exactement l'idée de question / réponse." },
          { type: 'practice', html: "Improvise 2 minutes avec seulement 3 notes, puis 4, puis toute la box. Varie le rythme plutôt que les notes.", settings: { overlayType: 'scale', root: 9, scaleId: 'penta-minor', box: 1 } },
        ],
      },
      {
        id: 'tension',
        title: 'Tension et résolution',
        minutes: 5,
        summary: "La note sur laquelle tu finis change tout.",
        blocks: [
          { type: 'p', html: "Chaque degré a sa personnalité. Terminer une phrase sur la tonique, c'est <b>conclure</b> ; sur le 4, c'est <b>laisser en attente</b> ; sur le b7, c'est <b>bluesy</b>. Jouer avec ces sensations, c'est créer de la tension puis la relâcher." },
          { type: 'feelings' },
          { type: 'p', html: "Ces sensations dépendent aussi de l'accord joué en dessous : le même Do sonne « mélancolique » sur La mineur et « lumineux » sur La bémol majeur." },
          { type: 'tip', html: "Sur la page Manche, le panneau Combo affiche la sensation de chaque fin de phrase. Essaie de terminer volontairement sur chacune et écoute la différence." },
          { type: 'practice', html: "Fais 4 phrases : la 1re finit sur le 5, la 2e sur le 4, la 3e sur le b7, la 4e sur la tonique. Tu viens d'écrire un petit solo avec un début et une fin.", settings: { overlayType: 'scale', root: 9, scaleId: 'penta-minor' } },
        ],
      },
      {
        id: 'targets',
        title: "Viser les notes de l'accord",
        minutes: 6,
        summary: 'Suivre les changements d’accords au lieu de les ignorer.',
        blocks: [
          { type: 'p', html: "Une gamme te dit quelles notes sont « autorisées ». Mais parmi elles, les <b>notes de l'accord en cours</b> (1, 3, 5) sont les plus solides : poser une note longue dessus sonne toujours bien. On les appelle les <b>notes cibles</b>." },
          { type: 'neck', root: 9, pattern: 'scale:penta-minor', frets: 12, highlight: { root: 2, intervals: [0, 3, 7] }, caption: 'La pentatonique mineure, avec les notes de Rém (Ré, Fa, La) mises en avant : sur l’accord de Rém, vise-les.' },
          { type: 'p', html: "Quand l'accord change, change de cible. Sur une grille Lam → Rém, vise le <b>Do</b> (tierce de Lam) puis glisse vers le <b>Ré</b> ou le <b>Fa</b> (notes de Rém) : ton solo « suit » l'harmonie, et ça s'entend tout de suite." },
          { type: 'tip', html: "La <b>tierce</b> de l'accord est la cible la plus expressive : c'est elle qui dit si l'accord est majeur ou mineur." },
          { type: 'practice', html: 'Ouvre La mineur et clique sur les accords sous le manche (Lam, Rém, Mim) : joue une phrase sur chacun en visant ses notes.', settings: { overlayType: 'scale', root: 9, scaleId: 'minor' } },
        ],
      },
      {
        id: 'expression',
        title: 'Bends, slides, vibrato',
        minutes: 5,
        summary: 'Ce qui fait chanter une note.',
        blocks: [
          { type: 'p', html: "Deux guitaristes qui jouent les mêmes notes ne sonnent pas pareil : la différence est dans l'<b>expression</b>." },
          {
            type: 'table',
            head: ['Technique', 'Comment', 'À essayer en La (box 1)'],
            rows: [
              ['Bend', 'Pousser la corde pour monter la note de ½ ton ou 1 ton', 'Corde de Si case 8 : Sol → La'],
              ['Slide', 'Glisser d’une case à l’autre sans relâcher', 'Corde de Sol : case 5 → 7'],
              ['Hammer-on', 'Frapper une case avec un doigt sans regratter', 'Corde de Sol : 5 puis frapper la 7'],
              ['Pull-off', 'Tirer le doigt pour faire sonner la case plus basse', 'Corde de Si : 8 → 5'],
              ['Vibrato', 'Petits bends rapides et réguliers sur une note tenue', 'Sur le La de la corde de Mi aigu, case 5'],
            ],
          },
          { type: 'tip', html: "Un bend doit arriver <b>juste</b> : joue d'abord la note cible (La, case 10 de la corde de Si), puis bende la case 8 jusqu'à entendre la même hauteur. L'accordeur du Manche t'aide à vérifier." },
          { type: 'p', html: "Bonus : l'app reconnaît les bends et les slides et les compte dans ton combo." },
          { type: 'practice', html: 'Box 1 : fais 10 bends d’un ton sur la corde de Si (case 8), en vérifiant la justesse.', settings: { overlayType: 'scale', root: 9, scaleId: 'penta-minor', box: 1 } },
        ],
      },
      {
        id: 'rhythm',
        title: 'Le rythme dans le solo',
        minutes: 4,
        summary: 'Le rythme compte plus que les notes.',
        blocks: [
          { type: 'p', html: "Une phrase avec 3 notes et un bon rythme sonne mieux qu'une phrase avec 20 notes jouées « en vrac ». Quelques idées pour varier :" },
          { type: 'p', html: "<b>Change de subdivision</b> : noires, puis croches, puis triolets.<br><b>Commence ailleurs que sur le temps</b> : démarrer une phrase sur le « et » du temps 2 sonne tout de suite plus groovy.<br><b>Répète un motif rythmique</b> en changeant les notes.<br><b>Notes longues</b> : tiens une note avec du vibrato pendant toute une mesure." },
          { type: 'tip', html: "Exercice : choisis UNE note (la tonique) et improvise seulement avec le rythme pendant une minute. C'est étonnamment musical." },
          { type: 'practice', html: 'Mode jeu « Contre la montre » : essaie de faire monter le combo en jouant en rythme plutôt qu’en vitesse.', settings: { overlayType: 'scale', root: 9, scaleId: 'penta-minor', box: 1 } },
        ],
      },
    ],
  },
  {
    id: 'plus',
    title: 'Pour aller plus loin',
    lessons: [
      {
        id: 'caged',
        title: 'Le système CAGED',
        minutes: 6,
        summary: 'Relier accords, arpèges et gammes sur tout le manche.',
        blocks: [
          { type: 'p', html: "Les 5 formes d'accords ouverts <b>Do, La, Sol, Mi, Ré</b> (C A G E D) peuvent se déplacer partout sur le manche. Mises bout à bout, elles couvrent <b>tout le manche</b> pour un même accord." },
          { type: 'neck', root: 0, pattern: 'chord:maj', frets: 15, caption: 'Toutes les notes de Do majeur. Dans le mode Accord du Manche, choisis une forme pour voir le doigté.' },
          { type: 'p', html: "Chaque forme d'accord est entourée par une box de la gamme : connaître la forme te donne les notes cibles (l'arpège), la box te donne les notes de passage. C'est le lien entre jouer en rythmique et improviser." },
          { type: 'tip', html: "L'ordre C → A → G → E → D se répète en montant le manche : après la forme de La vient toujours celle de Sol, etc." },
          { type: 'practice', html: 'Ouvre Do majeur en mode Accord et joue les 5 formes de la plus grave à la plus aiguë.', settings: { overlayType: 'chord', root: 0, chordId: 'maj' } },
        ],
      },
      {
        id: 'progressions',
        title: 'Les grilles courantes',
        minutes: 6,
        summary: 'Les enchaînements d’accords que tu croiseras partout.',
        blocks: [
          {
            type: 'table',
            head: ['Grille', 'En Do / La m', 'Où ?', 'Quoi jouer'],
            rows: [
              ['I – IV – V', 'Do Fa Sol', 'rock, blues, country', 'Do majeur, penta majeure'],
              ['I – V – vi – IV', 'Do Sol Lam Fa', 'pop (des centaines de tubes)', 'Do majeur'],
              ['ii – V – I', 'Rém7 Sol7 Domaj7', 'jazz', 'Do majeur, en visant les tierces'],
              ['i – VI – VII', 'Lam Fa Sol', 'rock épique, metal', 'La mineur naturel'],
              ['i – iv – v', 'Lam Rém Mim', 'rock, ballades', 'La mineur, penta mineure'],
            ],
          },
          { type: 'p', html: 'Et la plus importante pour un guitariste, le <b>blues en 12 mesures</b> :' },
          { type: 'grid', bars: ['I7', 'I7', 'I7', 'I7', 'IV7', 'IV7', 'I7', 'I7', 'V7', 'IV7', 'I7', 'V7'], caption: 'En La : La7 (I), Ré7 (IV), Mi7 (V). La dernière mesure (V7) relance la grille.' },
          { type: 'listen', items: [{ label: 'I – V – vi – IV en Do', notes: [[48, 52, 55, 60, 64], [43, 47, 50, 55, 59, 67], [45, 52, 57, 60, 64], [41, 48, 53, 57, 60, 65]], chord: true }] },
          { type: 'tip', html: "Sur un blues, joue la pentatonique mineure de la tonique sur toute la grille, puis essaie de viser la tierce de chaque accord quand il change (Do# sur La7, Fa# sur Ré7, Sol# sur Mi7)." },
          { type: 'practice', html: 'Ouvre La blues et cherche « 12 bar blues in A » dans le lecteur Spotify.', settings: { overlayType: 'scale', root: 9, scaleId: 'blues' } },
        ],
      },
      {
        id: 'routine',
        title: 'Une routine de travail',
        minutes: 3,
        summary: '20 minutes par jour qui font progresser.',
        blocks: [
          { type: 'p', html: "La régularité bat la durée : 20 minutes par jour valent mieux que 3 heures le dimanche. Une routine simple :" },
          {
            type: 'table',
            head: ['Durée', 'Quoi', 'Dans l’app'],
            rows: [
              ['3 min', 'Échauffement : 1-2-3-4 sur chaque corde, lentement', 'Accordeur pour commencer juste'],
              ['5 min', 'Une box ou un mode, en montant et descendant', 'Manche, avec la box choisie'],
              ['5 min', 'Une technique : bends justes, slides, vibrato', 'Le combo compte les bends et les slides'],
              ['7 min', 'Improvisation sur une backing track', 'Mode jeu « Morceau »'],
            ],
          },
          { type: 'tip', html: "Enregistre-toi une fois par semaine sur la même backing track : c'est la meilleure façon d'entendre tes progrès (et ce qui reste à travailler)." },
        ],
      },
    ],
  },
]

export const ALL_LESSONS = COURSES.flatMap((c) => c.lessons.map((l) => ({ ...l, course: c })))
