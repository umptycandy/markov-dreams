/* SPDX-License-Identifier: MIT */
#pragma once
#ifdef PLAT_WEB
#pragma push_macro("__attribute__")
#undef __attribute__
#define EXPORT __attribute__((used,visibility("default")))
#else
#define EXPORT static
#endif
EXPORT void dream_command(int c,int t,int v){dream_dismiss_intro();if(c==111){bank_slot=clamp(v,0,bank_kind?63:15);bank_armed=-1;}else if(c==112){bank_kind=clamp(v,0,1);bank_slot=clamp(bank_slot,0,bank_kind?63:15);bank_armed=-1;}else if(c==115)bank_char=clamp(v,0,22);else if(c==116){bank_name[bank_char]=clamp(v,0,126);bank_name[23]=0;}else if(c==113)bank_action(0);else if(c==114)bank_action(1);else if(c==103)dream_prefs.motion=clamp(v,0,1);else if(c==104)dream_prefs.boot_sound=clamp(v,0,1);else if(c==105)dream_intro();else if(c==106){cpu_peak=0;plat_audio_peak_reset();}else dream_cmd(c,t,v);}
EXPORT void dream_page(int p){dream_dismiss_intro();dream_ui.page=clamp(p,0,22);dream_ui.help=-1;dream_ui.dirty=1;}
EXPORT void dream_track(int t){dream_ui.track=clamp(t,0,5);dream_ui.dirty=1;}
EXPORT int dream_value(int c,int t){const md_patch *p=md_state();const md_track *v=&p->track[clamp(t,0,5)];switch(c){case 107:return dream_ui.octave;case 108:return dream_ui.help;case 109:return md_status()->last_note[clamp(t,0,5)];case 110:return md_status()->events[clamp(t,0,5)];case 100:return dream_ui.page;case 101:return dream_ui.track;case 102:return p->edited_mask;case 103:return dream_prefs.motion;case 104:return dream_prefs.boot_sound;case MD_SCENE:return p->biome_id;case MD_TONE_PRESET:return p->tone_preset[clamp(t,0,5)];case MD_MODEL:return v->model;case MD_MUTE:return v->mute;case MD_MACRO:return p->macro[clamp(t,0,3)];case MD_PLAY:return md_playing();case MD_TEMPO:return p->tempo;case MD_LOCK:return p->locked;case MD_FREEZE:return p->freeze;case MD_QUALITY:return p->quality;default:return 0;}}

EXPORT const char *dream_bank_name(void){return bank_name;}
/* MARKOV DREAMS: what the knobs do now (0 main, 1 global, 2 sound page) and the dim key lights. */
EXPORT int dream_mk_page(void){return mk_edit_track()>=0?2:mk.global?1:0;}
EXPORT uint32_t dream_mk_keys_dim(void){return mk_keys_dim;}
EXPORT int dream_knob(int page,int track,int knob){
 const md_patch *p=md_state();const md_track *t=&p->track[clamp(track,0,5)];int k=clamp(knob,0,3);
 const md_extension *e=&p->ext[clamp(track,0,5)];
 int v[4]={0,0,0,0};switch(page){
 case SEQUENCE:{const md_sequence *q=&p->sequence[clamp(track,0,5)];v[0]=q->enabled;v[1]=q->edit;v[2]=q->steps[q->edit].note?q->steps[q->edit].note:23;v[3]=q->length;break;}
 case STEP_DETAIL:{const md_sequence *q=&p->sequence[clamp(track,0,5)];const md_step *s=&q->steps[q->edit];v[0]=s->velocity;v[1]=s->gate;v[2]=s->chance;v[3]=q->generator;break;}
 case PROGRESSION:v[0]=p->chord_pattern;v[1]=p->chord_bars;v[2]=(p->chord_tracks>>clamp(track,0,5))&1;v[3]=p->root;break;
 case CLOUD:v[0]=p->grain_noise;v[1]=p->macro[3];v[2]=t->send;v[3]=p->freeze;break;
 case MIDI:v[0]=md_clock_source();v[1]=md_midi_quantize();break;
 case BANKS:v[0]=bank_slot;v[1]=bank_kind;break;
 case MIXER:v[0]=t->level;v[1]=t->send;v[2]=e->delay_send;v[3]=e->reverb_send;break;
 case BASSLINE:v[0]=e->bass_mode;v[1]=e->pattern;v[2]=e->glide;v[3]=t->note;break;
 case SPACE:v[0]=p->delay_ms;v[1]=p->delay_fb;v[2]=p->reverb_time;v[3]=p->fx_level;break;
 case MODULATION:v[0]=e->marbles;v[1]=e->tides;v[2]=e->tides_rate;v[3]=e->warps;break;
 case PHRASE:v[0]=e->edit_step;v[1]=e->notes[e->edit_step];v[2]=t->accent;v[3]=t->prob;break;

 case APPEARANCE:v[0]=dream_prefs.motion;v[1]=dream_prefs.boot_sound;break;
 case LIVE:for(int j=0;j<4;j++)v[j]=p->macro[j]/10;break;
 case SOUND:v[0]=t->tone/10;v[1]=t->harm/10;v[2]=((md_has_envelope(t->model)||t->model==MD_ELEMENTS)?t->shape:t->decay)/10;v[3]=t->level/10;break;
 case FILTER:v[0]=md_cutoff_hz(t->cutoff);v[1]=t->resonance/10;v[2]=t->filter;v[3]=t->breathe/10;break;
 case RHYTHM:v[0]=t->hits;v[1]=t->length;v[2]=t->rotate;v[3]=t->prob/10;break;
 case GRAIN:v[0]=p->macro[3]/10;v[1]=p->grain_size/10;v[2]=p->grain_pos/10;v[3]=p->feedback/10;break;
 case MIX:v[0]=t->send/10;v[1]=t->note;v[2]=t->pan/10;v[3]=t->speed;break;
 case SYSTEM:v[0]=p->tempo;v[1]=p->quality;v[2]=40+p->duck_release*1460/1000;break;
 case ENVELOPE:v[0]=8*t->attack*t->attack/1000;v[1]=60+16*t->decay*t->decay/1000;v[2]=t->level/10;v[3]=t->send/10;break;
 case GROOVE:v[0]=p->swing/10;v[1]=t->ratchet;v[2]=t->accent/10;v[3]=t->speed;break;
 case TAPE:v[0]=p->grain_pitch;v[1]=p->reverse;v[2]=p->duck_source+1;v[3]=p->duck_amount*90/1000;break;
 case HARMONY:v[0]=p->root;v[1]=p->scale;v[2]=p->transpose;v[3]=p->tempo;break;
 }return v[k];
}

EXPORT int dream_raw_knob(int page,int track,int knob){
 const md_patch *p=md_state();const md_track *t=&p->track[clamp(track,0,5)];int k=clamp(knob,0,3);
 const md_extension *e=&p->ext[clamp(track,0,5)];
 int v[4]={0,0,0,0};switch(page){
 case SEQUENCE:{const md_sequence *q=&p->sequence[clamp(track,0,5)];v[0]=q->enabled;v[1]=q->edit;v[2]=q->steps[q->edit].note?q->steps[q->edit].note:23;v[3]=q->length;break;}
 case STEP_DETAIL:{const md_sequence *q=&p->sequence[clamp(track,0,5)];const md_step *s=&q->steps[q->edit];v[0]=s->velocity;v[1]=s->gate;v[2]=s->chance;v[3]=q->generator;break;}
 case PROGRESSION:v[0]=p->chord_pattern;v[1]=p->chord_bars;v[2]=(p->chord_tracks>>clamp(track,0,5))&1;v[3]=p->root;break;
 case CLOUD:v[0]=p->grain_noise;v[1]=p->macro[3];v[2]=t->send;v[3]=p->freeze;break;
 case MIDI:v[0]=md_clock_source();v[1]=md_midi_quantize();break;
 case BANKS:v[0]=bank_slot;v[1]=bank_kind;break;
 case MIXER:v[0]=t->level;v[1]=t->send;v[2]=e->delay_send;v[3]=e->reverb_send;break;
 case BASSLINE:v[0]=e->bass_mode;v[1]=e->pattern;v[2]=e->glide;v[3]=t->note;break;
 case SPACE:v[0]=p->delay_ms;v[1]=p->delay_fb;v[2]=p->reverb_time;v[3]=p->fx_level;break;
 case MODULATION:v[0]=e->marbles;v[1]=e->tides;v[2]=e->tides_rate;v[3]=e->warps;break;
 case PHRASE:v[0]=e->edit_step;v[1]=e->notes[e->edit_step];v[2]=t->accent;v[3]=t->prob;break;

 case APPEARANCE:v[0]=dream_prefs.motion;v[1]=dream_prefs.boot_sound;break;
 case LIVE:for(int j=0;j<4;j++)v[j]=p->macro[j];break;
 case SOUND:v[0]=t->tone;v[1]=t->harm;v[2]=(md_has_envelope(t->model)||t->model==MD_ELEMENTS)?t->shape:t->decay;v[3]=t->level;break;
 case FILTER:v[0]=t->cutoff;v[1]=t->resonance;v[2]=t->filter;v[3]=t->breathe;break;
 case RHYTHM:v[0]=t->hits;v[1]=t->length;v[2]=t->rotate;v[3]=t->prob;break;
 case GRAIN:v[0]=p->macro[3];v[1]=p->grain_size;v[2]=p->grain_pos;v[3]=p->feedback;break;
 case MIX:v[0]=t->send;v[1]=t->note;v[2]=t->pan;v[3]=t->speed;break;
 case SYSTEM:v[0]=p->tempo;v[1]=p->quality;v[2]=p->duck_release;break;
 case ENVELOPE:v[0]=t->attack;v[1]=t->decay;v[2]=t->level;v[3]=t->send;break;
 case GROOVE:v[0]=p->swing;v[1]=t->ratchet;v[2]=t->accent;v[3]=t->speed;break;
 case TAPE:v[0]=p->grain_pitch;v[1]=p->reverse;v[2]=p->duck_source;v[3]=p->duck_amount;break;
 case HARMONY:v[0]=p->root;v[1]=p->scale;v[2]=p->transpose;v[3]=p->tempo;break;
 }return v[k];
}

/* Preserve quick pointer edges between simulator frames. No device driver changes. */
EXPORT void dream_input_edge(void){app_input_only();}

/* Browser patch exchange. The AudioWorklet calls this between render quanta. */
static md_patch browser_patch;
EXPORT const void *dream_patch_data(void){return md_state();}
EXPORT unsigned dream_patch_size(void){return sizeof(md_patch);}
EXPORT void *dream_patch_buffer(void){return &browser_patch;}
EXPORT int dream_patch_apply(unsigned n){
 if(n>sizeof(md_patch)||md_playing())return 0;
 if(!dream_install(&browser_patch,n))return 0;
 dream_dismiss_intro();dream_ui.help=-1;dream_ui.dirty=1;return 1;
}
#ifdef PLAT_WEB
#pragma pop_macro("__attribute__")
#endif
