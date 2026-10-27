/* SPDX-License-Identifier: GPL-3.0-only */
/* MARKOV DREAMS brain: a C port of reference/markov-sid/brain.js.
 * Control logic only: it runs once per bar on the UI side, never in audio.
 * Notes are semitone intervals from the root, kept in -24..+39. Tables are
 * fixed size (about 2 KB per brain) so they can later be saved to flash.
 * Included by app.c after dream_cmd(). */
enum { BR_LO=-24, BR_SPAN=64, BR_LINKS=192, BR_BRAINS=5, BR_NONE=-128 };
typedef struct { uint8_t from,to,count; } br_link;                 /* one transition prev -> next */
typedef struct { uint16_t bars,seen,on[16]; uint8_t uni[BR_SPAN],links; int8_t prev; br_link link[BR_LINKS]; } br_notes;
typedef struct { uint16_t bars,seen[3],on[3][16]; } br_drums;
typedef struct { br_drums drums; br_notes notes[3]; } br_brain;      /* notes: bass, lead, chords */
/* One generated step. lane 0 uses k/s/h; lanes 1-3 use iv, len and arp. */
typedef struct { uint8_t on,k,s,h,rat,len,arp; int8_t iv; } br_step;
typedef struct { br_step lane[4][16]; } br_bar;

static br_brain br_bank[BR_BRAINS];
static uint8_t br_ready;
static uint32_t br_rng=0x2545F491u;
static const char *br_names[BR_BRAINS]={"DARK ARP","HYPER BASS","BROKEN 4/4","GLASS","BLANK"};

/* ---------- learning ---------- */
static int br_index(int iv){return clamp(iv-BR_LO,0,BR_SPAN-1);}
static void br_halve(br_notes *b){
 // Make room by forgetting: halve every count and drop the ones that reach 0.
 unsigned k=0;for(unsigned i=0;i<b->links;i++){b->link[i].count>>=1;if(b->link[i].count)b->link[k++]=b->link[i];}b->links=k;
}
static void br_note_add(br_notes *b,int step,int iv){
 int n=br_index(iv);
 if(!((b->seen>>step)&1)){b->on[step]++;b->seen|=1u<<step;}
 if(b->uni[n]==255)for(int i=0;i<BR_SPAN;i++)b->uni[i]>>=1;
 b->uni[n]++;
 if(b->prev!=BR_NONE){
  int at=-1;for(unsigned i=0;i<b->links;i++)if(b->link[i].from==b->prev&&b->link[i].to==n){at=i;break;}
  if(at>=0&&b->link[at].count==255){br_halve(b);at=-1;for(unsigned i=0;i<b->links;i++)if(b->link[i].from==b->prev&&b->link[i].to==n){at=i;break;}}
  if(at<0){
   if(b->links==BR_LINKS)br_halve(b);
   if(b->links==BR_LINKS){at=0;for(unsigned i=1;i<b->links;i++)if(b->link[i].count<b->link[at].count)at=i;}else at=b->links++;
   b->link[at].from=(uint8_t)b->prev;b->link[at].to=(uint8_t)n;b->link[at].count=0;
  }
  b->link[at].count++;
 }
 b->prev=(int8_t)n;
}
static void br_note_bar(br_notes *b){
 if(b->bars==60000){b->bars>>=1;for(int s=0;s<16;s++)b->on[s]>>=1;}
 b->bars++;b->seen=0;
}
static void br_drum_add(br_drums *d,int step,int lane){if(!((d->seen[lane]>>step)&1)){d->on[lane][step]++;d->seen[lane]|=1u<<step;}}
static void br_drum_bar(br_drums *d){
 if(d->bars==60000){d->bars>>=1;for(int l=0;l<3;l++)for(int s=0;s<16;s++)d->on[l][s]>>=1;}
 d->bars++;d->seen[0]=d->seen[1]=d->seen[2]=0;
}
static float br_note_p(const br_notes *b,int s){return b->bars?fm_minf(1,(float)b->on[s]/b->bars):0;}
static float br_drum_p(const br_drums *d,int l,int s){return d->bars?fm_minf(1,(float)d->on[l][s]/d->bars):0;}

/* ---------- presets: semitones from the root, '.' is a rest; drums x / . ---------- */
typedef struct { const char *name; const char *drums[2][3]; const char *bass[2],*lead[2],*chord[2]; } br_preset;
static const br_preset br_presets[BR_BRAINS]={
 {"DARK ARP",{{"x.......x.x.....","....x.......x...","..x...x...x...x."},{"x.......x.....x.","....x.......x..x","..x...x...x.x.x."}},
  {"0 . . 0 . . 0 . -2 . . -2 . . -5 .","0 . . 0 . . 0 . 3 . . 3 . . -2 ."},
  {"12 15 19 24 19 15 12 15 10 14 17 22 17 14 10 14","12 15 19 24 19 15 12 15 8 12 15 20 15 12 7 10"},
  {"0 . . . . . . . -2 . . . . . . .","-4 . . . . . . . -2 . . . . . . ."}},
 {"HYPER BASS",{{"x...x...x...x...","....x.......x...","x.xxx.xxx.xxx.xx"},{"x...x...x...x.x.","....x.......x.xx","x.xxx.xxx.xxx.xx"}},
  {"0 12 0 12 0 12 0 12 3 15 3 15 -2 10 -2 10","0 12 0 12 0 12 0 12 5 17 5 17 3 15 -2 10"},
  {"24 . . . . . 22 . 19 . . . . . . .","24 . . 27 . . 26 . 22 . . . 19 . . ."},
  {"0 . . . . . . . 3 . . . -2 . . .","0 . . . . . . . 5 . . . 3 . . ."}},
 {"BROKEN 4/4",{{"x..x..x...x..x..","....x..x....x...","x.x.xx.x.x.x.xx."},{"x..x......x.x...","....x..x....x.x.","x.x.x.xxx.x.x.xx"}},
  {"0 . . 0 . . 3 . . . 0 . . -2 . .","0 . . 0 . . 5 . . . 3 . . 7 . ."},
  {". . 12 . . 15 . . 19 . . . 17 . 15 .",". . 12 . . 15 . . 22 . 19 . 17 . 15 12"},
  {". . 0 . . . . . . . 3 . . . . .",". . 0 . . . . . . . -2 . . . . ."}},
 {"GLASS",{{"x.....x...x.....","....x.......x...","..x...x...x...x."},{0,0,0}},
  {"0 . . . . . . . -4 . . . -2 . . .","0 . . . . . . . 3 . . . -2 . . ."},
  {"24 19 15 12 24 19 15 12 22 19 15 10 22 19 15 10","20 15 12 8 20 15 12 8 19 14 10 7 22 19 14 10"},
  {"0 . . . . . . . -4 . . . -2 . . .",0}},
 {"BLANK",{{0,0,0},{0,0,0}},{0,0},{0,0},{0,0}},
};
static void br_parse(const char *s,int8_t out[16]){
 for(int i=0;i<16;i++)out[i]=BR_NONE;
 for(int i=0;s&&*s&&i<16;i++){
  while(*s==' ')s++;
  if(*s=='.'){s++;continue;}
  int neg=*s=='-';if(neg)s++;int v=0;while(*s>='0'&&*s<='9')v=v*10+(*s++-'0');out[i]=(int8_t)(neg?-v:v);
 }
}
static void br_learn_notes(br_notes *b,const char *const bars[2]){
 int first=BR_NONE;
 for(int k=0;k<2&&bars[k];k++){int8_t n[16];br_parse(bars[k],n);
  for(int s=0;s<16;s++)if(n[s]!=BR_NONE){if(first==BR_NONE)first=n[s];br_note_add(b,s,n[s]);}
  br_note_bar(b);
 }
 // Close the loop: the last note leads back to the first.
 if(first!=BR_NONE){br_note_add(b,0,first);b->on[0]--;}
 b->prev=BR_NONE;b->seen=0;
}
static br_brain *br_get(int i){
 i=clamp(i,0,BR_BRAINS-1);br_brain *B=&br_bank[i];
 if(!((br_ready>>i)&1)){
  memset(B,0,sizeof *B);for(int t=0;t<3;t++)B->notes[t].prev=BR_NONE;
  const br_preset *p=&br_presets[i];
  for(int k=0;k<2&&p->drums[k][0];k++){for(int l=0;l<3;l++)for(int s=0;s<16;s++)if(p->drums[k][l][s]=='x')br_drum_add(&B->drums,s,l);br_drum_bar(&B->drums);}
  br_learn_notes(&B->notes[0],p->bass);br_learn_notes(&B->notes[1],p->lead);br_learn_notes(&B->notes[2],p->chord);
  br_ready|=1u<<i;
 }
 return B;
}

/* ---------- generation ---------- */
static float br_rand(void){br_rng^=br_rng<<13;br_rng^=br_rng>>17;br_rng^=br_rng<<5;return (br_rng>>8)*(1.0f/16777216.0f);}
static float br_shape(float p,float T,float dens){
 // WILD flattens the learned pattern; DENSITY thins it or fills it in.
 float tb=fm_clampf((T-1)/1.5f,0,1)*.35f;p=p*(1-tb)+.4f*tb*(p>0?1:.5f);
 if(dens<.5f)p*=dens*2;else p=p+(1-p)*(dens-.5f)*2*.55f;
 return fm_clampf(p,0,1);
}
static int br_pick(const br_notes *b,int prev,float T){
 // Sample the next interval from prev's transition row, weight^(1/T); no row: all notes heard.
 float tot=0,inv=1/T;int rows=0;
 if(prev!=BR_NONE)for(unsigned i=0;i<b->links;i++)if(b->link[i].from==prev){tot+=fm_powf(b->link[i].count,inv);rows++;}
 if(rows){float r=br_rand()*tot;int last=0;
  for(unsigned i=0;i<b->links;i++)if(b->link[i].from==prev){last=b->link[i].to;r-=fm_powf(b->link[i].count,inv);if(r<=0)return last;}
  return last;}
 for(int n=0;n<BR_SPAN;n++)if(b->uni[n])tot+=fm_powf(b->uni[n],inv);
 if(tot<=0)return BR_NONE;
 float r=br_rand()*tot;int last=BR_NONE;
 for(int n=0;n<BR_SPAN;n++)if(b->uni[n]){last=n;r-=fm_powf(b->uni[n],inv);if(r<=0)return n;}
 return last;
}
static int br_in_scale(int iv,int root,int scale){int n=60+root+iv;return md_quantize(n,root,scale)==n;}
static int br_quant(int iv,int root,int scale){return md_quantize(60+root+iv,root,scale)-60-root;}
/* wild, dens: 0..1. arp[lane]: arps wanted. prev[lane]: last note, carried from bar to bar. */
static void br_generate(br_brain *B,float wild,float dens,int root,int scale,const uint8_t arp[4],int8_t prev[4],br_bar *out){
 float T=.2f+wild*2.3f,G=fm_maxf(0,wild-.55f)*1.4f;
 memset(out,0,sizeof *out);
 for(int s=0;s<16;s++){br_step *st=&out->lane[0][s];
  st->k=br_rand()<br_shape(br_drum_p(&B->drums,0,s),T,dens);
  st->s=br_rand()<br_shape(br_drum_p(&B->drums,1,s),T,dens);
  st->h=br_rand()<br_shape(br_drum_p(&B->drums,2,s),T,dens);
  st->on=st->k||st->s||st->h;st->rat=1;st->len=1;
  if(st->on&&br_rand()<G*(st->h?.35f:.15f))st->rat=2+(int)(br_rand()*3);
 }
 static const int lo[4]={0,-12,-5,-7},hi[4]={0,19,31,19},tie[4]={0,2,1,8};
 for(int t=1;t<4;t++){const br_notes *b=&B->notes[t-1];int p=prev[t];
  for(int s=0;s<16;s++){br_step *st=&out->lane[t][s];
   if(!(br_rand()<br_shape(br_note_p(b,s),T,dens)))continue;
   int n;
   if(T>1&&br_rand()<(T-1)*.35f){int c=p!=BR_NONE?p:0;float x=(br_rand()*2-1)*9;n=c+(int)(x<0?x-.5f:x+.5f);}
   else{int k=br_pick(b,p==BR_NONE?BR_NONE:br_index(p),T);n=k==BR_NONE?0:k+BR_LO;}
   n=clamp(br_quant(n,root,scale),lo[t],hi[t]);p=n;
   st->on=1;st->iv=(int8_t)n;st->len=1;st->rat=1;
   if(t!=3&&br_rand()<G*.12f)st->rat=2+(int)(br_rand()*2);
   if(arp[t]&&(t==3||br_rand()<.55f)){
    int third=br_in_scale(n+3,root,scale)?3:4,fifth=br_in_scale(n+7,root,scale)?7:br_in_scale(n+6,root,scale)?6:7;
    st->arp=MD_BAR_ARP|(third==4?MD_BAR_ARP_MAJOR:0)|(fifth==6?MD_BAR_ARP_FLAT5:0)|(br_rand()<.5f?MD_BAR_ARP_OCTAVE:0);
   }
  }
  prev[t]=(int8_t)p;
  // Hold notes into the rests that follow: bass a little, chords a lot.
  for(int s=0;s<16;s++){br_step *st=&out->lane[t][s];if(!st->on)continue;int L=1;while(s+L<16&&!out->lane[t][s+L].on&&L<tie[t])L++;st->len=L;}
 }
 // Half-bar stutters at high WILD.
 for(int t=0;t<3;t++){
  if(br_rand()<G*.22f){for(int s=8;s<16;s++)out->lane[t][s]=out->lane[t][s-8];}
  else if(br_rand()<G*.18f){for(int s=12;s<16;s++)out->lane[t][s]=out->lane[t][s-4];}
 }
}
/* The engine's form: drums on tracks 0-2, bass/lead/chords on 3-5. A muted lane
 * (TEACH) plays rests so you hear yourself. */
static void br_to_md(const br_bar *g,const md_patch *p,int root,int muted_lane,md_bar *m){
 static const int base[4]={0,36,48,48};
 memset(m,0,sizeof *m);m->mask=63;
 for(int i=0;i<6;i++)for(int s=0;s<16;s++){m->steps[i][s]=(md_step){0,80,100,50};m->len[i][s]=1;}
 for(int s=0;s<16;s++){const br_step *st=&g->lane[0][s];const uint8_t hit[3]={st->k,st->s,st->h};
  if(muted_lane==0)break;
  for(int l=0;l<3;l++)if(hit[l]){
   static const uint8_t vel[3]={96,88,70};
   m->steps[l][s]=(md_step){(uint8_t)clamp(p->track[l].note,24,96),(uint8_t)(vel[l]+(s%4==0?4:0)),100,60};
   m->flags[l][s]=st->rat>1?st->rat:0;
  }
 }
 for(int t=1;t<4;t++){if(t==muted_lane)continue;
  for(int s=0;s<16;s++){const br_step *st=&g->lane[t][s];if(!st->on)continue;
   m->steps[t+2][s]=(md_step){(uint8_t)clamp(base[t]+root+st->iv,24,96),(uint8_t)(s==0?95:85),100,92};
   m->len[t+2][s]=st->len;m->flags[t+2][s]=st->arp?st->arp:st->rat>1?st->rat:0;
  }
 }
}
