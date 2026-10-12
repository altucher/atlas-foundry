// BLOCKED ATLASES (AI2 2026-10-12, Master): firearms, munitions/explosives and military weapon systems are not served and not built. The 28 keys below are existing atlases (weapon_like in the
// explode index): they are hidden from the gallery list and every lookup answers "not found"; the data stays in the blob store (the founder decides on deletion). New builds of the same
// class are refused by refusedSubject(). ATLAS_BLOCKED_KEYS (comma separated) adds keys without a deploy; ATLAS_JOBS_REFUSE / ATLAS_REFUSE_WORDS add words.
export const BLOCKED_KEYS = new Set([
  '742-remington-30-06', 'anduril-fury', 'bar-automatic-rifle-browning-fn', 'cz-75-d-compact-pcr', 'defense-drone', 'f-14', 'f-35-fighter-jet', 'glock-19', 'glock-9mm',
  'golden-dome-suppliers', 'javelin', 'm1911', 'machine-gun', 'military-drone', 'military-drones', 'military-grade-drones', 'mossberg-500-shotgun',
  'oscillator-for-thad-missile-defense-system', 'remington-1100-automatic-shotgun', 'remington-1100-semi-automatic-shotgun', 'remington-model-700-rifle', 'sig-p365',
  'sig-sauer-p365', 'smith-wesson-1911-45-acp', 'smith-wesson-45-acp', 'ssg11', 'thaad-radar-and-sensory-systemsaoly', 'usg-dept-war-m-80-firecracker-1940s',
]);

export function isBlockedKey(key: string) {
  if (BLOCKED_KEYS.has(key)) return true;
  const extra = process.env.ATLAS_BLOCKED_KEYS?.split(',').map((k) => k.trim()).filter(Boolean) ?? [];
  return extra.includes(key);
}

const REFUSED = /\b(guns?|firearms?|rifles?|pistols?|revolvers?|shotguns?|handguns?|machine ?guns?|carbines?|assault weapons?|ammunition|ammo|bullets?|cartridges?|grenades?|bombs?|explosives?|detonators?|landmines?|missiles?|warheads?|nuclear weapons?|bioweapons?|chemical weapons?|nerve agents?|torpedo(?:es)?|artillery|howitzers?|thaad|silencers?|suppressors?|ar-?15|ak-?47|hk ?416|glock|sig ?sauer|molotov|ieds?|pipe bomb|firecrackers?|tnt|dynamite|fighter jets?|bombers?|military (?:drones?|aircraft|jets?|vehicles?)|combat (?:aircraft|drones?)|attack drones?|kamikaze drones?|warships?|battle ?tanks?|f-(?:14|15|16|18|22|35)|a-10 warthog|b-(?:2|52)|predator drone|reaper drone)\b/i;

// everyday things that contain a refused word are let through ("glue gun", "bath bomb", "ink cartridge", "bullet train")
const HARMLESS = /\b(?:(?:glue|hot glue|nail|heat|spray|staple|caulk(?:ing)?|grease|paint|soldering|water|bb|nerf|dart|cat|tattoo|radar|speed) guns?|(?:bath|photo|cherry|atom) ?bombs?|(?:ink|toner|printer|filter|water|gas|game|vape|coffee|tape) cartridges?|bullet (?:train|journal|point|proof glass)|bullets? (?:train|journal))\b/gi;

export function refusedSubject(subject: string) {
  const text = subject.replace(HARMLESS, ' ');
  if (REFUSED.test(text)) return true;
  const extra = [process.env.ATLAS_JOBS_REFUSE, process.env.ATLAS_REFUSE_WORDS].flatMap((v) => v?.split(',') ?? []).map((w) => w.trim().toLowerCase()).filter(Boolean);
  const lower = subject.toLowerCase();
  return extra.some((word) => lower.includes(word));
}
