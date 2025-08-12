import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function registerUser({ uid, username, firstName, lastName, langCode }) {
  const { error } = await supabase
    .from('users')
    .upsert({
      uid,
      username,
      first_name: firstName,
      last_name: lastName,
      lang_code: langCode,
      registered_at: new Date().toISOString()
    }, { onConflict: ['uid'] });

  if (error) throw error;
}
