// Client Supabase côté serveur : utilise la clé service_role, qui CONTOURNE les policies RLS.
// Ce fichier ne doit jamais être importé côté frontend — uniquement dans ce backend.
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

module.exports = { supabaseAdmin };
