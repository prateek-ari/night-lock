import Gio from 'gi://Gio';

const UUID = 'night-lock@local';
const mode = ARGV[0];
if (mode !== 'enable' && mode !== 'disable')
    throw new Error('Usage: gjs -m shell-settings.js enable|disable');

const settings = new Gio.Settings({schema_id: 'org.gnome.shell'});
const enabled = settings.get_strv('enabled-extensions').filter(uuid => uuid !== UUID);
const disabled = settings.get_strv('disabled-extensions').filter(uuid => uuid !== UUID);

if (mode === 'enable')
    enabled.push(UUID);

settings.set_strv('enabled-extensions', enabled);
settings.set_strv('disabled-extensions', disabled);
