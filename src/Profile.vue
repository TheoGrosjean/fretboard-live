<script setup>
// Page Profil : connexion par lien magique, puis ton compte — nom, synchronisation, et ton parcours de
// guitariste (séances, temps joué, série de jours, records, phrasés à revoir).
import { computed, onActivated, ref } from 'vue'
import ActivityHeatmap from './components/profile/ActivityHeatmap.vue'
import { useAccount } from './composables/useAccount'
import { deleteRemotePhrases, flushSave, openRequest, phrases, sync, syncNow } from './composables/phraseStore'
import { isDue, mastery, reviewLabel } from './lib/phraseCoach'
import { dayLabel, durationOf } from './components/phrases/format'

const account = useAccount()
const st = account.state
const email = ref('')
const code = ref('')
const codeOpen = ref(false) // la saisie du code (si le modèle d'e-mail en contient un) reste repliée

// ---------- Connexion ----------
const canSend = computed(() => /.+@.+\..+/.test(email.value.trim()) && !st.sending)
const send = () => canSend.value && account.sendLink(email.value)
const verify = () => code.value.trim().length >= 6 && account.verifyCode(code.value)

// ---------- Nom ----------
const nameShown = computed(() => st.profile?.display_name || account.user?.email?.split('@')[0] || '')
function saveName(e) {
  const v = e.target.value.trim().slice(0, 60)
  if (v && v !== st.profile?.display_name) account.updateProfile({ display_name: v })
  else e.target.value = nameShown.value
}

// ---------- Synchronisation ----------
const now = ref(Date.now())
onActivated(() => {
  now.value = Date.now()
  flushSave()
})
const syncText = computed(() => {
  if (sync.state === 'syncing') return 'Synchronisation…'
  if (sync.state === 'offline') return 'Hors ligne : tout est gardé sur cet appareil, l’envoi reprendra au retour du réseau'
  if (sync.state === 'error') return sync.error
  if (!sync.at) return 'En attente'
  const s = Math.round((now.value - sync.at) / 1000)
  return `Synchronisé ${s < 60 ? 'à l’instant' : `il y a ${Math.round(s / 60)} min`}`
})
async function syncAll() {
  now.value = Date.now()
  await Promise.all([syncNow(), account.syncSettings()])
  now.value = Date.now()
}

// ---------- Parcours ----------
const recorded = computed(() => phrases.value.filter((p) => p.notes.length))
const allSessions = computed(() => phrases.value.flatMap((p) => p.sessions))
const totals = computed(() => {
  const s = allSessions.value
  const passes = s.reduce((a, x) => a + x.passes, 0)
  const clean = s.reduce((a, x) => a + x.clean, 0)
  return { sessions: s.length, time: s.reduce((a, x) => a + (x.duration || 0), 0), passes, cleanPct: passes ? Math.round((100 * clean) / passes) : 0 }
})
// Série : jours consécutifs avec au moins une séance, jusqu'à aujourd'hui (ou hier)
const streak = computed(() => {
  const days = new Set(allSessions.value.map((x) => new Date(x.at).toDateString()))
  const d = new Date()
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1)
  let n = 0
  while (days.has(d.toDateString())) {
    n++
    d.setDate(d.getDate() - 1)
  }
  return n
})
const best = computed(() => recorded.value.reduce((a, p) => (p.bestBpm > (a?.bestBpm ?? 0) ? p : a), null))
const mastered = computed(() => recorded.value.filter((p) => mastery(p) >= 100).length)
const due = computed(() => recorded.value.filter((p) => isDue(p)).length)
const ranked = computed(() =>
  [...recorded.value].sort((a, b) => (isDue(b) ? 1 : 0) - (isDue(a) ? 1 : 0) || mastery(b) - mastery(a)).slice(0, 8),
)
const lastPlayed = (p) => (p.sessions.length ? dayLabel(p.sessions.at(-1).at) : 'jamais travaillé')
const memberSince = computed(() => (account.user?.created_at ? new Date(account.user.created_at).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : ''))

function openPhrase(p) {
  localStorage.setItem('fb.phrases.selected', JSON.stringify(p.id))
  openRequest.value = p.id
  location.hash = '#phrases'
}

// ---------- Données en ligne ----------
const confirmWipe = ref(false)
const wiped = ref(false)
async function wipe() {
  if (!confirmWipe.value) return void (confirmWipe.value = true)
  confirmWipe.value = false
  wiped.value = await deleteRemotePhrases()
}
</script>

<template>
  <main class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-10">
    <!-- ========== Pas connecté : le lien magique ========== -->
    <section v-if="st.ready && !account.user" class="login">
      <div class="text-[10px] font-semibold tracking-widest text-copper-400 uppercase">Ton compte</div>
      <h1 class="mt-2 text-3xl font-black tracking-tight text-white">Tes phrasés, sur tous tes appareils.</h1>
      <ul class="mt-5 grid gap-3 text-sm text-neutral-400 sm:grid-cols-3">
        <li class="perk"><b>Sauvegardés en ligne</b>Tes phrasés, séances et statistiques ne dépendent plus d'un seul navigateur.</li>
        <li class="perk"><b>Partout</b>Commence sur l'ordinateur, continue sur le téléphone : tout se retrouve.</li>
        <li class="perk"><b>Sans mot de passe</b>Un lien de connexion arrive par e-mail. Rien à retenir.</li>
      </ul>

      <form v-if="!st.linkSentTo" class="mt-7 flex flex-wrap gap-2" @submit.prevent="send">
        <input v-model="email" type="email" autocomplete="email" placeholder="ton@email.fr" class="field min-w-64 flex-1" aria-label="Adresse e-mail" />
        <button class="primary" :disabled="!canSend">{{ st.sending ? 'Envoi…' : 'Recevoir un lien de connexion' }}</button>
      </form>
      <div v-else class="sent">
        <p class="text-neutral-200">
          Lien envoyé à <b>{{ st.linkSentTo }}</b>. Ouvre-le <b>dans ce navigateur</b> : tu seras connecté ici.
        </p>
        <p class="mt-1 text-sm text-neutral-500">Pense à regarder dans les indésirables. Le lien expire au bout d'une heure.</p>
        <form v-if="codeOpen" class="mt-3 flex flex-wrap gap-2" @submit.prevent="verify">
          <input v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="123456" class="field w-36 text-center tracking-[0.3em]" aria-label="Code reçu par e-mail" />
          <button class="primary" :disabled="code.trim().length < 6">Valider le code</button>
        </form>
        <div class="mt-3 flex flex-wrap gap-4 text-sm">
          <button v-if="!codeOpen" type="button" class="font-semibold text-neutral-500 hover:text-neutral-200" @click="codeOpen = true">L'e-mail contient un code ?</button>
          <button type="button" class="font-semibold text-neutral-500 hover:text-neutral-200" @click="account.cancelLink">Changer d'adresse</button>
        </div>
      </div>
      <p v-if="st.error" class="mt-3 text-sm text-rose-300">{{ st.error }}</p>
      <p class="mt-6 text-xs text-neutral-600">Sans compte, tout continue de fonctionner : tes données restent sur cet appareil. À la première connexion, elles rejoignent ton compte.</p>
    </section>

    <!-- ========== Connecté ========== -->
    <template v-else-if="account.user">
      <header class="flex flex-wrap items-center gap-5">
        <div class="avatar">{{ account.initial }}</div>
        <div class="min-w-0 flex-1">
          <input :value="nameShown" class="name-input" maxlength="60" aria-label="Ton nom" @blur="saveName" @keydown.enter="$event.target.blur()" />
          <div class="mt-1 text-sm text-neutral-500">{{ account.user.email }}<template v-if="memberSince"> · membre depuis {{ memberSince }}</template></div>
        </div>
        <div class="sync" :class="sync.state">
          <span class="dot" />
          <span class="max-w-64 text-xs">{{ syncText }}</span>
          <button class="secondary h-8 px-3 text-xs" :disabled="sync.state === 'syncing'" @click="syncAll">Synchroniser</button>
        </div>
      </header>

      <!-- Parcours -->
      <div class="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div class="tile">
          <span class="tile-label">Série</span>
          <span class="tile-value">{{ streak }}<small> j</small></span>
          <span class="tile-sub">{{ streak ? 'd’affilée' : 'joue aujourd’hui !' }}</span>
        </div>
        <div class="tile">
          <span class="tile-label">Temps joué</span>
          <span class="tile-value text-2xl">{{ totals.time ? durationOf(totals.time) : '—' }}</span>
          <span class="tile-sub">{{ totals.sessions }} séance{{ totals.sessions > 1 ? 's' : '' }}</span>
        </div>
        <div class="tile">
          <span class="tile-label">Passages propres</span>
          <span class="tile-value">{{ totals.cleanPct }}<small> %</small></span>
          <span class="tile-sub">sur {{ totals.passes }}</span>
        </div>
        <div class="tile">
          <span class="tile-label">Phrasés</span>
          <span class="tile-value">{{ recorded.length }}</span>
          <span class="tile-sub">{{ mastered }} maîtrisé{{ mastered > 1 ? 's' : '' }}</span>
        </div>
        <div class="tile">
          <span class="tile-label">Record</span>
          <span class="tile-value">{{ best?.bestBpm || '—' }}<small v-if="best"> BPM</small></span>
          <span class="tile-sub truncate">{{ best?.name ?? 'aucun encore' }}</span>
        </div>
        <div class="tile">
          <span class="tile-label">À revoir</span>
          <span class="tile-value" :class="due ? 'text-copper-300' : ''">{{ due }}</span>
          <span class="tile-sub">aujourd’hui</span>
        </div>
      </div>

      <div class="card mt-6">
        <ActivityHeatmap :sessions="allSessions" />
      </div>

      <!-- Tes phrasés -->
      <div class="card mt-6">
        <div class="mb-3 flex items-center justify-between">
          <span class="text-[10px] font-semibold tracking-widest text-neutral-500 uppercase">Tes phrasés</span>
          <a href="#phrases" class="text-xs font-semibold text-copper-300 hover:text-copper-400">Ouvrir la page Phrasés →</a>
        </div>
        <p v-if="!ranked.length" class="text-sm text-neutral-600">Pas encore de phrasé : enregistre ton premier sur la page Phrasés.</p>
        <ul class="divide-y divide-white/5">
          <li v-for="p in ranked" :key="p.id">
            <button class="phrase-row" @click="openPhrase(p)">
              <span class="min-w-0 flex-1">
                <span class="block truncate font-bold text-neutral-100">{{ p.name }}</span>
                <span class="text-xs text-neutral-500">{{ p.notes.length }} notes · {{ lastPlayed(p) }}<template v-if="p.bestBpm"> · record {{ p.bestBpm }} BPM</template></span>
              </span>
              <span v-if="isDue(p)" class="due">{{ reviewLabel(p) }}</span>
              <span class="w-28">
                <span class="flex justify-between text-[10px] text-neutral-500"><span>maîtrise</span><span>{{ mastery(p) }} %</span></span>
                <span class="meter"><i :style="{ width: mastery(p) + '%' }" /></span>
              </span>
            </button>
          </li>
        </ul>
      </div>

      <!-- Compte -->
      <div class="card mt-6 text-sm text-neutral-400">
        <div class="mb-3 text-[10px] font-semibold tracking-widest text-neutral-500 uppercase">Compte et données</div>
        <p>Synchronisés avec ton compte : tes phrasés (notes, séances, statistiques), l'accordage et l'affichage de la guitare, tes préférences d'entraînement. Le calage du micro reste propre à chaque appareil : il dépend de ton installation.</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button class="secondary" @click="account.signOut">Se déconnecter</button>
          <button class="secondary text-rose-300" @click="wipe" @blur="confirmWipe = false">{{ confirmWipe ? 'Confirmer : effacer mes phrasés en ligne' : 'Effacer mes phrasés en ligne' }}</button>
        </div>
        <p v-if="wiped" class="mt-2 text-xs text-neutral-500">Phrasés en ligne effacés. Ceux de cet appareil sont intacts ; ils repartiront à la prochaine modification.</p>
        <p v-if="st.error" class="mt-2 text-xs text-rose-300">{{ st.error }}</p>
      </div>
    </template>

    <div v-else class="py-20 text-center text-sm text-neutral-600">Chargement du compte…</div>
  </main>
</template>

<style scoped>
@reference "./style.css";

.login {
  @apply rounded-2xl p-8 ring-1 ring-white/5;
  background: radial-gradient(120% 140% at 0% 0%, rgba(201, 120, 70, 0.12), transparent 55%), #171514;
}
.perk {
  @apply rounded-xl bg-white/[0.03] p-4 leading-relaxed ring-1 ring-white/5;
}
.perk b {
  @apply mb-1 block text-neutral-100;
}
.field {
  @apply h-11 rounded-xl bg-neutral-900 px-4 text-base text-neutral-100 ring-1 ring-white/10 outline-none placeholder:text-neutral-600 focus:ring-copper-400/60;
}
.primary {
  @apply h-11 rounded-xl bg-copper-500 px-5 text-sm font-bold text-white transition hover:bg-copper-400 disabled:opacity-40 disabled:hover:bg-copper-500;
}
.secondary {
  @apply h-11 rounded-xl px-4 text-sm font-semibold text-neutral-300 ring-1 ring-white/10 transition hover:bg-white/5 hover:text-white disabled:opacity-40;
}
.sent {
  @apply mt-7 rounded-xl bg-copper-500/[0.07] p-4 ring-1 ring-copper-400/25;
}
.avatar {
  @apply flex size-16 shrink-0 items-center justify-center rounded-2xl text-3xl font-black text-white shadow-lg;
  background: linear-gradient(135deg, var(--color-copper-400), var(--color-copper-600));
}
.name-input {
  @apply w-full rounded-lg bg-transparent text-3xl font-black tracking-tight text-white outline-none;
}
.name-input:hover,
.name-input:focus {
  @apply bg-white/[0.03];
}
.sync {
  @apply flex items-center gap-2.5 rounded-xl bg-white/[0.03] py-2 pr-2 pl-3 text-neutral-400 ring-1 ring-white/5;
}
.sync .dot {
  @apply size-2 shrink-0 rounded-full bg-neutral-600;
}
.sync.ok .dot {
  @apply bg-emerald-400;
}
.sync.syncing .dot {
  @apply animate-pulse bg-copper-400;
}
.sync.offline .dot,
.sync.error .dot {
  @apply bg-rose-400;
}
.tile {
  @apply flex min-w-0 flex-col gap-1 rounded-xl bg-neutral-900 p-4 ring-1 ring-white/5;
}
.tile-label {
  @apply text-[10px] font-semibold tracking-widest text-neutral-500 uppercase;
}
.tile-value {
  @apply text-3xl leading-none font-black text-white;
}
.tile-value small {
  @apply text-sm font-semibold text-neutral-500;
}
.tile-sub {
  @apply text-xs text-neutral-500;
}
.card {
  @apply rounded-2xl bg-neutral-900 p-5 ring-1 ring-white/5;
}
.phrase-row {
  @apply flex w-full items-center gap-4 rounded-lg px-2 py-3 text-left transition hover:bg-white/[0.03];
}
.due {
  @apply rounded-full bg-copper-500/15 px-2 py-0.5 text-[11px] font-semibold text-copper-300 ring-1 ring-copper-400/40;
}
.meter {
  @apply mt-1 block h-1.5 overflow-hidden rounded-full bg-copper-500/15;
}
.meter i {
  @apply block h-full rounded-full bg-copper-500;
}
</style>
