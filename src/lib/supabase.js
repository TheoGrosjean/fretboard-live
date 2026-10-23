// Client Supabase (comptes et sauvegarde en ligne). La clé est publique par nature : ce sont les règles
// d'accès de la base (voir supabase/schema.sql) qui protègent les données de chacun.
import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://nnhirifpebomrammzzns.supabase.co'
const PUBLISHABLE_KEY = 'sb_publishable_15oAqFZ8fksP9p5-fE0IDw_pgVgn0Vg'

export const supabase = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
  auth: {
    flowType: 'pkce', // le lien magique revient avec ?code= (le # reste libre pour les onglets du site)
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'fb.auth',
  },
})
