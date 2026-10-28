/* SPDX-License-Identifier: GPL-3.0-only */
/* MARKOV DREAMS surface, after reference/markov-sid/prototype.html:
 * one main page (four lanes), a sound page while a track button is held,
 * a global page (GLO), pop-up lists, TEACH / FREEZE / ARP, and the brain's
 * bar scheduling. Included by app.c; the 1.2 pages stay in app.c, hidden. */
enum { MK_LONG_MS=450 };
static const char *mk_lane_long[4]={"DRUMS","BASS","LEAD","CHORDS"};
static const uint8_t mk_white_keys[16]={0,2,4,6,7,9,11,12,14,16,18,19,21,23,24,26};
static const int mk_base[4]={0,36,48,48};               /* MIDI note of interval 0 at root C */
static struct {
 int edit,latched,turned,engine_acc,was_selected,global,teach,frozen,brain,reroll,kit_mod,setup;
 uint32_t down_at,applied_seen,last_bar,queued_bar;int queued;
 uint8_t arp[4];int8_t prev[4];
 br_bar cur,next;int have_cur,have_next;
 char pop[6][28];int pop_n;uint32_t pop_until;
} mk;
static md_bar mk_out;
static void mk_kit_setup(void);
static uint32_t mk_keys_dim;                          /* for the browser: dim key lights */

static int mk_lane(void){return md_lane(dream_ui.track);}
static uint16_t mk_colour(int lane){return dream_colors[lane?lane+2:0];}
static int mk_edit_track(void){return mk.edit>=0?mk.edit:mk.latched;}

/* ---------- pop-ups ---------- */
static void mk_copy(char *d,const char *s,unsigned n){unsigned i=0;while(s&&s[i]&&i+1<n){d[i]=s[i];i++;}d[i]=0;}
static void mk_popup(const char *a,const char *b,const char *c,unsigned ms){
 const char *l[3]={a,b,c};mk.pop_n=0;for(int i=0;i<3;i++)if(l[i])mk_copy(mk.pop[mk.pop_n++],l[i],28);
 mk.pop_until=plat_ms()+ms;dream_ui.dirty=1;ann_say(mk.pop[0],0,ANN_NOW);
}
static void mk_list(const char *title,const char *(*name)(int),int count,int at){
 mk_copy(mk.pop[0],title,28);mk.pop_n=6;
 for(int d=-2;d<=2;d++){int i=(at+d+count)%count;char *o=mk.pop[d+3];char num[8];md_num(i+1,num);
  o[0]=d?' ':'>';o[1]=0;unsigned n=1;if(i+1<10)o[n++]='0';for(char *c=num;*c;)o[n++]=*c++;o[n++]=' ';
  for(const char *c=name(i);*c&&n<27;)o[n++]=*c++;o[n]=0;}
 mk.pop_until=plat_ms()+1000;dream_ui.dirty=1;ann_say(name(at),0,ANN_NOW);
}
static const char *mk_brain_name(int i){return br_names[i];}

/* ---------- the brain, one bar ahead ---------- */
static void mk_queue(int fresh){
 const md_patch *p=md_state();
 if(fresh||!mk.have_cur)br_generate(br_get(mk.brain),p->macro[1]/1000.f,p->macro[0]/1000.f,p->root,p->scale,mk.arp,mk.prev,&mk.next);
 else mk.next=mk.cur;
 br_to_md(&mk.next,p,p->root,mk.teach?mk_lane():-1,&mk_out);
 uint32_t f=plat_lock();md_queue_bar(&mk_out);plat_unlock(f);
 mk.have_next=1;mk.reroll=0;
}
static void mk_resend(void){
 if(!mk.have_next||!md_bar_pending())return;const md_patch *p=md_state();
 br_to_md(&mk.next,p,p->root,mk.teach?mk_lane():-1,&mk_out);uint32_t f=plat_lock();md_queue_bar(&mk_out);plat_unlock(f);
}
static void mk_teach_bar(void){
 br_brain *B=br_get(mk.brain);int lane=mk_lane();
 if(lane==0){br_drums *d=&B->drums;if(d->seen[0]|d->seen[1]|d->seen[2])br_drum_bar(d);}
 else{br_notes *n=&B->notes[lane-1];if(n->seen)br_note_bar(n);}
}
static void mk_tick(void){
 const md_stats *st=md_status();
 if(mk.setup){if(mk.setup==2)dream_cmd(MD_MACRO,1,350);mk.setup=0;mk_kit_setup();}   /* WILD starts where the prototype does */
 if(st->bars_applied!=mk.applied_seen){mk.applied_seen=st->bars_applied;if(mk.have_next){mk.cur=mk.next;mk.have_cur=1;mk.have_next=0;}}
 if(!md_playing())return;
 uint32_t bar=st->step/16;
 if(bar!=mk.last_bar){if(mk.teach)mk_teach_bar();mk.last_bar=bar;}
 // Like the prototype: past step 10, prepare the next bar. FREEZE repeats the current one.
 if(st->step%16>=10&&mk.queued_bar!=bar+1){mk.queued_bar=bar+1;mk_queue(!mk.frozen||mk.reroll);}
}
static void mk_play(int on){
 if(on){mk.prev[1]=mk.prev[2]=mk.prev[3]=BR_NONE;mk_queue(!mk.have_cur||!mk.frozen);mk.queued_bar=0;mk.last_bar=0;dream_cmd(MD_PLAY,0,1);}
 else{dream_cmd(MD_PLAY,0,0);if(mk.teach){mk_teach_bar();mk.teach=0;}}
}
static void mk_teach(int on){
 br_brain *B=br_get(mk.brain);int lane=mk_lane();
 if(on){
  mk.teach=1;if(lane==0)B->drums.seen[0]=B->drums.seen[1]=B->drums.seen[2]=0;else{B->notes[lane-1].seen=0;B->notes[lane-1].prev=BR_NONE;}
  if(!md_playing())mk_play(1);else mk_resend();
  mk_popup(lane==0?"TEACH DRUMS":lane==1?"TEACH BASS":lane==2?"TEACH LEAD":"TEACH CHORDS",lane==0?"LO KICK / MID SNARE / HI HAT":"PLAY YOUR RIFF",0,1400);
 }else{
  mk_teach_bar();mk.teach=0;mk_resend();char n[24];md_num(lane==0?B->drums.bars:B->notes[lane-1].bars,n);
  char line[28];mk_copy(line,n,28);unsigned k=0;while(line[k])k++;mk_copy(line+k," BARS",28-k);mk_popup("LEARNED",line,0,900);
 }
}

/* ---------- kit: the whole band; your knobs, tempo and harmony stay ---------- */
static void mk_cloud(int v){
 // CLOUD: grain send and room on LEAD and CHORDS only; drums and bass stay dry.
 for(int t=4;t<6;t++){dream_cmd(MD_SEND,t,v*8/10);dream_cmd(MD_REVERB_SEND,t,100+v*7/10);dream_cmd(MD_DELAY_SEND,t,v*35/100);}
}
static void mk_kit_setup(void){
 const md_patch *p=md_state();
 for(int t=0;t<4;t++){dream_cmd(MD_SEND,t,0);dream_cmd(MD_REVERB_SEND,t,0);dream_cmd(MD_DELAY_SEND,t,0);}
 dream_cmd(MD_GRAIN_SIZE,0,450);dream_cmd(MD_GRAIN_POS,0,300);dream_cmd(MD_FEEDBACK,0,250);dream_cmd(MD_GRAIN_NOISE,0,0);
 dream_cmd(MD_REVERSE,0,0);dream_cmd(MD_FREEZE,0,0);dream_cmd(MD_DUCK_SOURCE,0,0);
 mk_cloud(p->macro[3]);
}
static void mk_load_kit(int id){
 const md_patch *p=md_state();int keep[9]={p->macro[0],p->macro[1],p->macro[2],p->macro[3],p->tempo,p->root,p->scale,p->swing,p->duck_amount};
 if(md_playing())mk_queue(0);
 dream_cmd(MD_SCENE,0,id);
 for(int j=0;j<4;j++)dream_cmd(MD_MACRO,j,keep[j]);
 dream_cmd(MD_TEMPO,0,keep[4]);dream_cmd(MD_ROOT,0,keep[5]);dream_cmd(MD_SCALE,0,keep[6]);dream_cmd(MD_SWING,0,keep[7]);dream_cmd(MD_DUCK,0,keep[8]);
 mk_kit_setup();mk.kit_mod=0;
}

/* ---------- sound page: engines that suit each role ---------- */
static const int8_t mk_engines[4][10]={{-1},{MD_BASS,MD_FM,MD_VA,MD_MELLOW,MD_SATIN,MD_HARMONIC,-1},
 {MD_VELVET_KEYS,MD_FM,MD_VA,MD_RINGS,MD_ELEMENTS,MD_MELLOW,MD_HARMONIC,MD_SATIN,-1},
 {MD_CHOIR,MD_SATIN,MD_HARMONIC,MD_VA,MD_SPECTRAL,MD_BREATH,MD_MELLOW,MD_VELVET_KEYS,MD_RINGS,-1}};
static int mk_first_tone(int model){return model>=12?224+(model-12)*16:model==11?208:model==10?160:model*16;}
static int mk_engine_count(int t){if(t<3)return 16;int n=0;while(n<10&&mk_engines[t-2][n]>=0)n++;return n;}
static int mk_engine_index(int t){
 const md_patch *p=md_state();
 if(t<3){int id=p->tone_preset[t];return id>=t*16&&id<t*16+16?id-t*16:0;}
 for(int i=0;i<mk_engine_count(t);i++)if(mk_engines[t-2][i]==p->track[t].model)return i;
 return 0;
}
static void mk_engine_step(int t,int dir){
 // Drums: the 16 sounds of that drum. Others: the next engine, from its first sound.
 int n=mk_engine_count(t),i=(mk_engine_index(t)+dir+n)%n;
 dream_cmd(MD_TONE_PRESET,t,t<3?t*16+i:mk_first_tone(mk_engines[t-2][i]));
}

/* ---------- controls ---------- */
static void mk_knob(int k,int d){
 const md_patch *p=md_state();int et=mk_edit_track();
 if(et>=0){const md_track *t=&p->track[et];mk.turned=1;
  mk.kit_mod=1;
  if(k==0){mk.engine_acc+=d;if(mk.engine_acc>-3&&mk.engine_acc<3)return;mk_engine_step(et,mk.engine_acc>0?1:-1);mk.engine_acc=0;return;}
  const int c[3]={MD_TONE,MD_HARM,MD_DECAY},v[3]={t->tone,t->harm,t->decay};
  dream_cmd(c[k-1],et,clamp(v[k-1]+d*25,0,1000));return;
 }
 if(mk.global){
  if(k==0)dream_cmd(MD_SWING,0,clamp(p->swing+d*20,0,600));
  else if(k==1){dream_cmd(MD_ROOT,0,(p->root+d%12+12)%12);mk.reroll=1;}
  else if(k==2){dream_cmd(MD_SCALE,0,(p->scale+d%8+8)%8);mk.reroll=1;}
  else{dream_cmd(MD_DUCK_SOURCE,0,0);dream_cmd(MD_DUCK,0,clamp(p->duck_amount+d*25,0,1000));}
  return;
 }
 static const int macro[4]={1,0,2,3};                  /* WILD, DENSITY, TONE, CLOUD */
 int v=clamp(p->macro[macro[k]]+d*25,0,1000);dream_cmd(MD_MACRO,macro[k],v);if(k==3)mk_cloud(v);
}
static void mk_kit(int d){const md_patch *p=md_state();int id=((p->biome_id<0?0:p->biome_id)+d%MD_BIOMES+MD_BIOMES)%MD_BIOMES;mk_load_kit(id);mk_list("KIT",md_biome_name,MD_BIOMES,id);}
static void mk_brain(int d){
 mk.brain=(mk.brain+d%BR_BRAINS+BR_BRAINS)%BR_BRAINS;if(mk.teach)mk_teach(0);
 mk.prev[1]=mk.prev[2]=mk.prev[3]=BR_NONE;mk.reroll=1;mk_list("BRAIN",mk_brain_name,BR_BRAINS,mk.brain);
}
static void mk_tempo(int d){const md_patch *p=md_state();int v=clamp(p->tempo+d,40,220);dream_cmd(MD_TEMPO,0,v);char s[12];md_num(v,s);unsigned n=0;while(s[n])n++;mk_copy(s+n," BPM",12-n);mk_popup("TEMPO",s,0,700);}
static void mk_track_down(int lane){
 mk.was_selected=mk_lane()==lane;
 if(mk.latched>=0&&md_lane(mk.latched)!=lane)mk.latched=-1;
 if(!mk.was_selected){if(mk.teach)mk_teach(0);dream_ui.track=lane?lane+2:0;}
 mk.edit=dream_ui.track;mk.turned=0;mk.engine_acc=0;mk.down_at=plat_ms();
}
static void mk_track_up(int lane){
 int held=(uint32_t)(plat_ms()-mk.down_at)>=MK_LONG_MS;
 if(mk.latched==dream_ui.track&&!held&&!mk.turned)mk.latched=-1;
 else if(held&&!mk.turned)mk.latched=dream_ui.track;          /* long press: keep the sound page open */
 else if(!held&&!mk.turned&&mk.was_selected&&lane==0){dream_ui.track=(dream_ui.track+1)%3;mk_popup("DRUMS",track_names[dream_ui.track],0,700);}
 mk.edit=-1;
}
/* Returns 1 when the button is handled here; SAVE keeps its 1.2 behaviour. */
static int mk_tap(int b){
 char line[28];
 switch(b){
 case B_GLO:mk.global=!mk.global;mk.latched=-1;return 1;
 case B_HOME:mk.global=0;mk.latched=-1;return 1;
 case B_EDIT:return 1;
 case B_ARP:{int lane=mk_lane();if(!lane){mk_popup("NO ARP","ON DRUMS",0,700);return 1;}
  mk.arp[lane]=!mk.arp[lane];mk.reroll=1;mk_copy(line,mk_lane_long[lane],28);unsigned n=0;while(line[n])n++;mk_copy(line+n," ARP",28-n);
  mk_popup(line,mk.arp[lane]?"ON":"OFF",0,700);return 1;}
 case B_SEQ:mk.frozen=!mk.frozen;mk_popup(mk.frozen?"FROZEN":"EVOLVING",0,0,700);return 1;
 case B_PLAY:mk_play(!md_playing());return 1;
 case B_REC:mk_teach(!mk.teach);return 1;
 case B_OCTDN:case B_OCTUP:dream_ui.octave=clamp(dream_ui.octave+(b==B_OCTUP?1:-1),-3,3);
  line[0]=dream_ui.octave>0?'+':dream_ui.octave<0?'-':' ';line[1]='0'+(dream_ui.octave<0?-dream_ui.octave:dream_ui.octave);line[2]=0;
  mk_popup("OCTAVE",line,0,700);return 1;
 }
 return 0;
}
/* Keys: drums split low / mid / high into kick / snare / hat; bass sits an octave down. */
static void mk_keys(uint32_t keys){
 const md_patch *p=md_state();
 for(int b=0;b<27;b++){
  if((keys>>b&1)&&!(dream_ui.keys>>b&1)){dream_dismiss_intro();if(dream_ui.help>=0)continue;
   int lane=mk_lane(),tr,note;
   if(lane==0){tr=b<9?0:b<18?1:2;note=clamp(p->track[tr].note,24,96);}
   else{tr=dream_ui.track;note=clamp(53+b+dream_ui.octave*12-(lane==1?12:0),24,96);}
   keyboard_track[b]=tr;keyboard_note[b]=note;dream_cmd(MD_TRIGGER,tr,note);
   if(mk.teach&&md_playing()){
    // Quantise to the nearest step of the loop.
    const md_stats *st=md_status();int s=st->step%16;if(st->step_phase>.5f)s=(s+1)%16;
    br_brain *B=br_get(mk.brain);
    if(lane==0)br_drum_add(&B->drums,s,tr);else br_note_add(&B->notes[lane-1],s,note-mk_base[lane]-p->root);
   }
  }
  if(!(keys>>b&1)&&(dream_ui.keys>>b&1))dream_cmd(MD_NOTE_OFF,keyboard_track[b],keyboard_note[b]);
 }
 dream_ui.keys=keys;
}
static void mk_lights(void){
 uint32_t now=plat_ms(),blink=(now/250)%2,lit=0,dim=0,keys_lit=dream_ui.keys,keys_dim=0;int lane=mk_lane();
 if(!(mk.latched>=0&&blink))lit|=1u<<lane_button[lane];
 if(mk.global)lit|=1u<<B_GLO;
 if(lane&&mk.arp[lane])lit|=1u<<B_ARP;
 if(md_playing())lit|=LED_PLAY_GREEN;
 if(mk.teach&&blink)lit|=1u<<B_REC;
 if(mk.frozen)lit|=1u<<B_SEQ;
 if(dream_ui.octave<0&&(dream_ui.octave==-3||blink))lit|=1u<<B_OCTDN;
 if(dream_ui.octave>0&&(dream_ui.octave==3||blink))lit|=1u<<B_OCTUP;
 // The white keys show the selected track's 16 steps; the playhead is bright.
 if(md_playing()&&mk.have_cur){int pos=md_status()->step%16;
  for(int s=0;s<16;s++){const br_step *st=&mk.cur.lane[lane][s];
   int hit=lane==0?(dream_ui.track==0?st->k:dream_ui.track==1?st->s:st->h):st->on;
   if(s==pos)keys_lit|=1u<<mk_white_keys[s];else if(hit&&!mk.teach)keys_dim|=1u<<mk_white_keys[s];}
 }
 mk_keys_dim=keys_dim;plat_lights(lit,keys_lit,dim,keys_dim,1);
}

/* ---------- screen ---------- */
#define MK_BLACK RGB(0,0,0)
static void mk_frame(int x,int y,int w,int h,uint16_t c){cv_rect(x,y,w,1,c);cv_rect(x,y+h-1,w,1,c);cv_rect(x,y,1,h,c);cv_rect(x+w-1,y,1,h,c);}
static void mk_right(int x,int y,const felucca_font_t *f,const char *s,uint16_t c){cv_text(x-text_w(f,s),y,f,s,c);}
static void mk_draw_grid(void){
 const md_patch *p=md_state();int sel=mk_lane(),pos=md_playing()?(int)(md_status()->step%16):-1;
 for(int t=0;t<4;t++){
  int y=20+t*44,cy=y+12,ch=29;uint16_t c=mk_colour(t);int muted=mk.teach&&t==sel;
  cv_text(8,y,&FONT_T,mk_lane_long[t],t==sel?c:MD_EDGE);
  if(t&&mk.arp[t])cv_text(8+text_w(&FONT_T,mk_lane_long[t])+6,y,&FONT_T,"ARP",t==sel?MD_INK:MD_EDGE);
  if(t==0&&sel==0)mk_right(232,y,&FONT_T,track_names[dream_ui.track],MD_INK);
  if(t==sel)mk_frame(5,y+10,230,ch+4,c);
  for(int s=0;s<16;s++)cv_rect(8+s*14,cy,12,ch,s%4?RGB(23,21,29):RGB(36,34,45));
  if(mk.have_cur)for(int s=0;s<16;s++){
   const br_step *st=&mk.cur.lane[t][s];int x=8+s*14;uint16_t ink=muted?md_tint(MD_BG,c,8):c;
   if(t==0){const uint8_t row[3]={st->h,st->s,st->k};for(int l=0;l<3;l++)if(row[l])cv_rect(x+1,cy+1+l*9,10,7,ink);}
   else if(st->on){
    static const int lo[4]={0,24,40,36},hi[4]={0,60,84,72};
    int note=mk_base[t]+p->root+st->iv,ny=cy+ch-6-(note-lo[t])*(ch-8)/(hi[t]-lo[t]);ny=clamp(ny,cy+1,cy+ch-6);
    int w=14*st->len-3;if(x+w>232)w=232-x;cv_rect(x+1,ny,w,4,ink);
    if(st->arp){cv_rect(x+1,ny-3,2,2,ink);cv_rect(x+5,ny-5,2,2,ink);}
   }
   if(st->rat>1)for(int r=0;r<st->rat;r++)cv_rect(x+1+r*3,cy+ch-3,2,2,MD_INK);
  }
  if(pos>=0)mk_frame(8+pos*14-1,cy-1,14,ch+2,MD_INK);
  if(muted){const char *m="TEACHING - PLAY KEYS";cv_text(120-text_w(&FONT_T,m)/2,cy+9,&FONT_T,m,MD_INK);}
 }
}
static void mk_draw_global(void){
 const md_patch *p=md_state();static const char *notes[]={"C","C#","D","D#","E","F","F#","G","G#","A","A#","B"};
 char sw[8];md_num(50+p->swing*25/1000,sw);unsigned n=0;while(sw[n])n++;sw[n]='%';sw[n+1]=0;
 char pump[8];md_num(p->duck_amount/10,pump);n=0;while(pump[n])n++;pump[n]='%';pump[n+1]=0;
 const char *name[4]={"SWING","ROOT","SCALE","PUMP"},*val[4]={sw,notes[p->root],md_scale_name(p->scale),pump};
 md_centre(30,&FONT_B,"GLOBAL",MD_INK);
 for(int i=0;i<4;i++){cv_text(24,64+i*30,&FONT_XS,name[i],MD_DIM);mk_right(216,62+i*30,&FONT_B,val[i],mk_colour(i));}
}
static void mk_draw_sound(int t){
 const md_patch *p=md_state();const md_track *k=&p->track[t];uint16_t c=mk_colour(md_lane(t));
 char title[28];mk_copy(title,track_names[t],28);unsigned n=0;while(title[n])n++;mk_copy(title+n," SOUND",28-n);
 md_centre(24,&FONT_B,title,c);
 cv_rect(12,46,216,26,c);
 const char *engine=t<3&&p->tone_preset[t]>=0?md_tone_name(p->tone_preset[t]):md_model_name(k->model);
 md_centre(51,&FONT_B,engine,MD_BG);
 if(t>=3&&p->tone_preset[t]>=0)md_centre(76,&FONT_XS,md_tone_name(p->tone_preset[t]),MD_DIM);
 const char *name[3]={"TONE","HARM","DECAY"};const int v[3]={k->tone,k->harm,k->decay};
 for(int i=0;i<3;i++){int y=96+i*28;char s[8];md_num(v[i]/10,s);n=0;while(s[n])n++;s[n]='%';s[n+1]=0;
  cv_text(14,y,&FONT_XS,name[i],MD_DIM);mk_right(226,y,&FONT_XS,s,MD_INK);cv_rect(14,y+15,212,6,RGB(42,40,51));cv_rect(14,y+15,212*v[i]/1000,6,c);}
 md_centre(180,&FONT_T,mk.latched==t?(t<3?"TAP DRM TO CLOSE":t==3?"TAP BAS TO CLOSE":t==4?"TAP LED TO CLOSE":"TAP CHD TO CLOSE"):"KNOB 1 = ENGINE",MD_EDGE);
}
static void mk_draw(void){
 const md_patch *p=md_state();int et=mk_edit_track(),sel=mk_lane();char s[32];
 cv_rect(0,0,240,17,MK_BLACK);cv_text(4,3,&FONT_T,br_names[mk.brain],MD_INK);
 md_num(p->tempo,s);mk_right(236,3,&FONT_T,s,mk.teach?RGB(255,70,70):mk.frozen?RGB(255,194,31):MD_DIM);
 if(mk.teach||mk.frozen)mk_right(232-text_w(&FONT_T,s),3,&FONT_T,mk.teach?"REC":"FRZ",mk.teach?RGB(255,70,70):RGB(255,194,31));
 if(et>=0)mk_draw_sound(et);else if(mk.global)mk_draw_global();else mk_draw_grid();
 cv_rect(0,196,240,44,MK_BLACK);
 if(et<0&&mk.global)cv_text(4,198,&FONT_T,"GLOBAL - PRESS GLO TO RETURN",MD_EDGE);
 else{cv_text(4,197,&FONT_T,"KIT",MD_EDGE);cv_text(30,196,&FONT_XS,md_biome_name(p->biome_id),MD_DIM);
  if(mk.kit_mod)cv_text(34+text_w(&FONT_XS,md_biome_name(p->biome_id)),196,&FONT_XS,"*",MD_DIM);}
 int v[4];const char *names[4];
 if(et>=0){static const char *n[4]={"ENGINE","TONE","HARM","DECAY"};const md_track *k=&p->track[et];int cnt=mk_engine_count(et);
  v[0]=cnt>1?mk_engine_index(et)*1000/(cnt-1):0;v[1]=k->tone;v[2]=k->harm;v[3]=k->decay;for(int i=0;i<4;i++)names[i]=n[i];}
 else if(mk.global){static const char *n[4]={"SWING","ROOT","SCALE","PUMP"};v[0]=p->swing*1000/600;v[1]=p->root*1000/11;v[2]=p->scale*1000/7;v[3]=p->duck_amount;for(int i=0;i<4;i++)names[i]=n[i];}
 else{static const char *n[4]={"WILD","DENSITY","TONE","CLOUD"};v[0]=p->macro[1];v[1]=p->macro[0];v[2]=p->macro[2];v[3]=p->macro[3];for(int i=0;i<4;i++)names[i]=n[i];}
 for(int i=0;i<4;i++){int x=4+i*59;cv_text(x,213,&FONT_T,names[i],MD_DIM);cv_rect(x,228,54,7,RGB(42,40,51));cv_rect(x,228,54*clamp(v[i],0,1000)/1000,7,mk_colour(sel));}
 if(mk.pop_n&&(int32_t)(mk.pop_until-plat_ms())>0){
  int n=mk.pop_n,h=20+n*15,y=108-h/2;uint16_t c=mk_colour(sel);
  cv_rect(24,y,192,h,MK_BLACK);mk_frame(24,y,192,h,c);
  for(int i=0;i<n;i++){const felucca_font_t *f=&FONT_XS;int x=(i==0||n<=3)?120-text_w(f,mk.pop[i])/2:40;cv_text(x,y+8+i*15,f,mk.pop[i],i==0?c:MD_INK);}
 }
}
static void mk_init(int fresh){
 memset(&mk,0,sizeof mk);mk.edit=mk.latched=-1;mk.arp[2]=mk.arp[3]=1;for(int i=0;i<4;i++)mk.prev[i]=BR_NONE;
 // Deferred to the first control tick: boot leaves the command queue empty, so a
 // patch install (USB editor, browser) right after boot is not refused.
 mk.setup=fresh?2:1;
}
