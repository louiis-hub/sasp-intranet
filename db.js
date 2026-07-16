// ── Supabase client ───────────────────────────────────────────────
var _sb = null;
function getDb() {
  if (!_sb) _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  return _sb;
}

var DB = {

  // ── Auth ──────────────────────────────────────────────────────
  async loginWithDiscord() {
    return getDb().auth.signInWithOAuth({
      provider: 'discord',
      options: {
        scopes: 'identify guilds.members.read',
        redirectTo: 'https://louiis-hub.github.io/sasp-intranet/',
        queryParams: { prompt: 'consent' }
      }
    });
  },
  async logout() { return getDb().auth.signOut(); },
  async getSession() { return getDb().auth.getSession(); },
  onAuthChange(cb) { return getDb().auth.onAuthStateChange(cb); },

  // ── App users (admin/academy roles) ──────────────────────────
  async getAppUser(userId) {
    var { data } = await getDb().from('app_users').select('*').eq('user_id', userId).single();
    return data;
  },
  async getAppUsers() {
    var { data } = await getDb().from('app_users').select('*').order('nom');
    return data || [];
  },
  async upsertAppUser(data) {
    return getDb().from('app_users').upsert(data, { onConflict: 'user_id' });
  },
  async updateAppUserRole(id, role) {
    return getDb().from('app_users').update({ app_role: role }).eq('id', id);
  },

  // ── Agents ───────────────────────────────────────────────────
  async getAgents(filters) {
    filters = filters || {};
    var q = getDb().from('agents').select('*').order('matricule');
    if (filters.statut) q = q.eq('statut', filters.statut);
    else q = q.neq('statut', 'Archivé');
    if (filters.grade)  q = q.eq('grade', filters.grade);
    if (filters.unite)  q = q.contains('unites', [filters.unite]);
    if (filters.search) {
      var s = filters.search;
      q = q.or('nom.ilike.%' + s + '%,prenom.ilike.%' + s + '%,matricule.ilike.%' + s + '%');
    }
    var { data } = await q;
    return data || [];
  },
  async getArchivedAgents(search) {
    var q = getDb().from('agents').select('*').eq('statut', 'Archivé').order('matricule');
    if (search) q = q.or('nom.ilike.%' + search + '%,prenom.ilike.%' + search + '%,matricule.ilike.%' + search + '%');
    var { data } = await q;
    return data || [];
  },
  async getFormateurs() {
    var { data } = await getDb().from('agents').select('id,prenom,nom,matricule,grade')
      .eq('is_formateur', true).neq('statut', 'Archivé').order('matricule');
    return data || [];
  },
  async checkMatricule(matricule, excludeId) {
    var q = getDb().from('agents').select('id').eq('matricule', matricule).neq('statut', 'Archivé');
    if (excludeId) q = q.neq('id', excludeId);
    var { data } = await q;
    return data && data.length > 0;
  },
  async getAgent(id) {
    var { data } = await getDb().from('agents').select('*').eq('id', id).single();
    return data;
  },
  async createAgent(data) {
    return getDb().from('agents').insert(data).select().single();
  },
  async updateAgent(id, data) {
    data.updated_at = new Date().toISOString();
    return getDb().from('agents').update(data).eq('id', id);
  },
  async getReferents() {
    var { data } = await getDb().from('agents')
      .select('id, nom, prenom, matricule, grade, referent_id, referent:referent_id(id, nom, prenom, matricule, grade)')
      .neq('statut', 'Archivé').order('matricule');
    return data || [];
  },
  async setReferent(agentId, referentId) {
    return getDb().from('agents').update({ referent_id: referentId || null, updated_at: new Date().toISOString() }).eq('id', agentId);
  },

  // ── Grades ───────────────────────────────────────────────────
  async getGrades() {
    var { data } = await getDb().from('grades').select('*').order('ordre', { ascending: false });
    return data || [];
  },
  async createGrade(data) { return getDb().from('grades').insert(data); },
  async updateGrade(id, data) { return getDb().from('grades').update(data).eq('id', id); },
  async deleteGrade(id) { return getDb().from('grades').delete().eq('id', id); },

  // ── Units ────────────────────────────────────────────────────
  async getUnits() {
    var { data } = await getDb().from('units').select('*').order('code');
    return data || [];
  },
  async createUnit(data) { return getDb().from('units').insert(data).select().single(); },
  async updateUnit(id, data) { return getDb().from('units').update(data).eq('id', id); },
  async deleteUnit(id) { return getDb().from('units').delete().eq('id', id); },

  // Logements de service
  async getServiceLogements() {
    var { data } = await getDb().from('service_logements')
      .select('*, agent:agent_id(id, nom, prenom, matricule, grade, telephone)')
      .order('numero');
    return data || [];
  },
  async updateServiceLogement(id, data) {
    data.updated_at = new Date().toISOString();
    return getDb().from('service_logements').update(data).eq('id', id).select().single();
  },
  async getServiceLogementPaiements(logementId) {
    var { data } = await getDb().from('service_logement_paiements')
      .select('*')
      .eq('logement_id', logementId)
      .order('date_paiement', { ascending: false });
    return data || [];
  },
  async upsertServiceLogementPaiement(data) {
    data.updated_at = new Date().toISOString();
    return getDb().from('service_logement_paiements')
      .upsert(data, { onConflict: 'logement_id,date_paiement' })
      .select()
      .single();
  },

  // ── Agent history ────────────────────────────────────────────
  async getHistory(agentId) {
    var { data } = await getDb().from('agent_historique')
      .select('*').eq('agent_id', agentId).order('date', { ascending: false });
    return data || [];
  },
  async addHistory(data) { return getDb().from('agent_historique').insert(data); },
  async deleteHistory(id) { return getDb().from('agent_historique').delete().eq('id', id); },

  // ── Agent armes ──────────────────────────────────────────────────
  async getAgentArmes(agentId) {
    var { data } = await getDb().from('agent_armes')
      .select('*').eq('agent_id', agentId).order('ppa_niveau').order('nom');
    return data || [];
  },
  async addAgentArme(data) { return getDb().from('agent_armes').insert(data).select().single(); },
  async deleteAgentArme(id) { return getDb().from('agent_armes').delete().eq('id', id); },
  async deleteAgent(id) {
    await getDb().from('agents').update({ formateur_id: null }).eq('formateur_id', id);
    return getDb().from('agents').delete().eq('id', id);
  },

  // ── Wiki sections ────────────────────────────────────────────
  async getWikiSections() {
    var { data } = await getDb().from('wiki_sections').select('*').order('ordre');
    return data || [];
  },
  async createWikiSection(data) { return getDb().from('wiki_sections').insert(data).select().single(); },
  async deleteWikiSection(id) { return getDb().from('wiki_sections').delete().eq('id', id); },

  // ── MDT ──────────────────────────────────────────────────────
  async getAllMdtPages() {
    var { data } = await getDb().from('mdt_pages')
      .select('id,titre,ordre,updated_at').is('categorie_id', null).order('ordre').order('titre');
    return data || [];
  },
  async getOrCreateWikiCat(slug) {
    var name = '__wiki_' + slug + '__';
    var { data: ex } = await getDb().from('mdt_categories').select('id').eq('nom', name).maybeSingle();
    if (ex) return ex.id;
    var { data: cr } = await getDb().from('mdt_categories').insert({ nom: name, emoji: '📄', ordre: -997 }).select().single();
    return cr ? cr.id : null;
  },
  async getOrCreateVehicleCat() {
    var { data: ex } = await getDb().from('mdt_categories').select('id').eq('nom','__vehicles__').maybeSingle();
    if (ex) return ex.id;
    var { data: cr } = await getDb().from('mdt_categories').insert({ nom:'__vehicles__', emoji:'🚗', ordre:-999 }).select().single();
    return cr ? cr.id : null;
  },
  async getAllVehiclePages(catId) {
    var { data } = await getDb().from('mdt_pages')
      .select('id,titre,ordre,updated_at').eq('categorie_id', catId).order('ordre').order('titre');
    return data || [];
  },
  async createVehiclePage(catId, data) {
    data.categorie_id = catId;
    return getDb().from('mdt_pages').insert(data).select().single();
  },
  async getMdtPage(id) {
    var { data } = await getDb().from('mdt_pages').select('*').eq('id', id).single();
    return data;
  },
  async createMdtCategory(data) {
    return getDb().from('mdt_categories').insert(data).select().single();
  },
  async updateMdtCategory(id, data) { return getDb().from('mdt_categories').update(data).eq('id', id); },
  async deleteMdtCategory(id) { return getDb().from('mdt_categories').delete().eq('id', id); },
  async createMdtPage(data) { return getDb().from('mdt_pages').insert(data).select().single(); },
  async updateMdtPage(id, data) {
    data.updated_at = new Date().toISOString();
    return getDb().from('mdt_pages').update(data).eq('id', id);
  },
  async deleteMdtPage(id) { return getDb().from('mdt_pages').delete().eq('id', id); },

  // ── Stats ────────────────────────────────────────────────────
  async getStats() {
    var d30 = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];
    var [ag, hist] = await Promise.all([
      getDb().from('agents').select('grade,statut,ppa1,ppa2,ppa3,qual_pa,qual_cid,qual_swat,qual_tu,qual_prd,unites'),
      getDb().from('agent_historique').select('type,date').gte('date', d30)
    ]);
    return { agents: ag.data || [], recentHist: hist.data || [] };
  },

  // ── Pointeuse ────────────────────────────────────────────────
  async getActivePointages() {
    var { data } = await getDb().from('pointages').select('*').is('clock_out', null);
    return data || [];
  },
  async clockIn(agentId) {
    return getDb().from('pointages').insert({ agent_id: agentId, clock_in: new Date().toISOString() }).select().single();
  },
  async clockOut(id) {
    return getDb().from('pointages').update({ clock_out: new Date().toISOString() }).eq('id', id);
  },
  async getAllPointages() {
    var { data } = await getDb().from('pointages')
      .select('*, agents(id, nom, prenom, matricule, grade, iban)')
      .order('clock_in', { ascending: false });
    return data || [];
  },
  async getCeremonieVotes() {
    var { data } = await getDb().from('ceremonie_votes').select('*').order('created_at', { ascending: true });
    return data || [];
  },
  async upsertCeremonieVote(v) {
    return getDb().from('ceremonie_votes').upsert(v, { onConflict: 'agent_id,voter_discord_id' });
  },
  async deleteCeremonieVotes() {
    return getDb().from('ceremonie_votes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  },
  async deletePointagesSince(since) {
    return getDb().from('pointages').delete().gte('clock_in', since);
  },
  async deletePointagesForAgent(agentId, since) {
    return getDb().from('pointages').delete().eq('agent_id', agentId).gte('clock_in', since);
  },
  async getPointageReport(since) {
    var { data } = await getDb().from('pointages')
      .select('*, agents(nom, prenom, matricule, grade)')
      .gte('clock_in', since)
      .order('clock_in', { ascending: false });
    return data || [];
  },

  // ── Search ───────────────────────────────────────────────────
  async search(q) {
    if (!q || q.length < 2) return { agents: [], mdt: [] };
    var [ag, mdt] = await Promise.all([
      getDb().from('agents').select('id,nom,prenom,matricule,grade,statut')
        .or('nom.ilike.%' + q + '%,prenom.ilike.%' + q + '%,matricule.ilike.%' + q + '%').limit(8),
      getDb().from('mdt_pages').select('id,titre,categorie_id').ilike('titre', '%' + q + '%').limit(6)
    ]);
    return { agents: ag.data || [], mdt: mdt.data || [] };
  }
};
