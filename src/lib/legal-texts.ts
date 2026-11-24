import { TERMS_VERSION } from './legal';

/**
 * Yasal metin TASLAKLARI. Yayına almadan önce bir avukata/KVKK danışmanına kontrol ettirin.
 * Köşeli parantezli alanlar ([ŞİRKET UNVANI] vb.) işletme bilgileriyle doldurulmalıdır.
 */
export interface LegalDoc { title: string; intro: string; sections: Array<{ h: string; p: string[] }> }

const OPERATOR = '[ŞİRKET UNVANI / AD SOYAD], [ADRES], [VERGİ DAİRESİ ve NO / MERSİS], e-posta: [İLETİŞİM E-POSTASI]';

export const LEGAL: Record<'terms' | 'privacy' | 'kvkk', LegalDoc> = {
  terms: {
    title: 'Kullanım Şartları',
    intro: `Bu şartlar, pazaryeri yönetim panelini ("Hizmet") kullanan herkes için geçerlidir. Hizmet ${OPERATOR} ("Hizmet Sağlayıcı") tarafından sunulur. Hesap açarak bu şartları kabul etmiş olursunuz.`,
    sections: [
      { h: '1. Hizmetin kapsamı', p: [
        'Hizmet; ürünlerinizi, stoklarınızı, siparişlerinizi ve kârlılığınızı Trendyol, Hepsiburada, N11, Çiçeksepeti, Pazarama, idefix, Koçtaş ve Etsy gibi pazaryerlerinde tek bir panelden yönetmenize yardım eden bir yazılımdır.',
        'Pazaryerleriyle bağlantı, sizin kendi satıcı hesabınızdan aldığınız API anahtarlarıyla ve o pazaryerinin izin verdiği ölçüde yapılır. Bir pazaryerinin desteklemediği işlem panelde "desteklenmiyor" olarak gösterilir.',
        'Kâr, komisyon, kargo ve vergi hesapları bilgilendirme amaçlı tahminlerdir; resmî muhasebe kaydı veya mali müşavir görüşü yerine geçmez.',
      ] },
      { h: '2. Hesap ve güvenlik', p: [
        'Kayıt sırasında doğru bilgi vermek ve şifrenizi gizli tutmak sizin sorumluluğunuzdadır. Hesabınızla yapılan işlemlerden siz sorumlusunuz.',
        'Mağazanıza davet ettiğiniz ekip üyelerinin yetkilerini siz belirlersiniz; onların panelde yaptığı işlemler işlem kaydında tutulur.',
        'Hesabınızın yetkisiz kullanıldığını fark ederseniz şifrenizi hemen değiştirip bize bildirin.',
      ] },
      { h: '3. Kullanıcının yükümlülükleri', p: [
        'Pazaryerlerinin satıcı sözleşmelerine, tüketici mevzuatına, vergi mevzuatına ve fikri mülkiyet haklarına uymak sizin sorumluluğunuzdadır.',
        'Hizmeti hukuka aykırı ürün satışı, başkasının verisine erişim veya sistemi bozmaya yönelik amaçlarla kullanamazsınız.',
        'Panele yüklediğiniz ürün bilgisi, fotoğraf ve açıklamaların kullanım hakkına sahip olduğunuzu kabul edersiniz.',
      ] },
      { h: '4. Pazaryerlerine gönderilen işlemler', p: [
        'Stok, fiyat, ürün ve sipariş durumu güncellemeleri pazaryerlerine otomatik gönderilir. Pazaryerinin geçici hatası veya yanıt vermemesi durumunda işlem kayda alınır ve belirli aralıklarla tekrar denenir; sonuç İşlem Merkezi\'nde gösterilir.',
        'Pazaryerlerinin kendi sistemlerindeki kesinti, kural veya API değişikliklerinden doğan sonuçlardan Hizmet Sağlayıcı sorumlu tutulamaz. Kritik işlemleri ilgili pazaryerinin satıcı panelinden de kontrol etmeniz önerilir.',
      ] },
      { h: '5. Ücretlendirme', p: [
        'Hizmet şu an ücretsiz sunulmaktadır. Ücretli paketlere geçilmesi halinde fiyatlar ve koşullar önceden duyurulur; onayınız olmadan ücret alınmaz.',
      ] },
      { h: '6. Sorumluluğun sınırı', p: [
        'Hizmet "olduğu gibi" sunulur. Kesintisiz veya hatasız çalışacağı garanti edilmez. Hizmet Sağlayıcı, kasıt veya ağır ihmali olmadıkça dolaylı zararlardan, kâr kaybından ve pazaryerlerince uygulanan yaptırımlardan sorumlu değildir.',
      ] },
      { h: '7. Hesabın kapatılması', p: [
        'Hesabınızı istediğiniz zaman kapatmayı talep edebilirsiniz. Şartlara aykırı kullanım halinde Hizmet Sağlayıcı hesabı askıya alabilir veya kapatabilir.',
        'Hesap kapatıldığında verileriniz, yasal saklama yükümlülükleri saklı kalmak üzere silinir veya anonim hale getirilir.',
      ] },
      { h: '8. Değişiklikler ve uygulanacak hukuk', p: [
        'Bu şartlar güncellenebilir; önemli değişiklikler panelde duyurulur. Bu şartlara Türkiye Cumhuriyeti hukuku uygulanır; uyuşmazlıklarda [İL] mahkemeleri ve icra daireleri yetkilidir. Tüketici sıfatını taşıyan kullanıcıların kanuni hakları saklıdır.',
      ] },
    ],
  },
  privacy: {
    title: 'Gizlilik Politikası',
    intro: `Bu politika, panelde hangi verilerin tutulduğunu, nasıl korunduğunu ve kimlerle paylaşıldığını açıklar. Veri sorumlusu: ${OPERATOR}.`,
    sections: [
      { h: 'Toplanan veriler', p: [
        'Hesap bilgileri: ad soyad, e-posta, şifrenin geri döndürülemez özeti (şifrenin kendisi saklanmaz), giriş zamanları, güvenlik amaçlı IP adresi.',
        'Mağaza verileri: ürün, stok, fiyat, maliyet, gider ve reklam harcaması bilgileri; pazaryeri API anahtarları (şifrelenmiş olarak).',
        'Sipariş verileri: pazaryerlerinden alınan siparişlerdeki alıcı adı, teslimat bilgileri, sipariş içeriği ve tutarları. Bu verilerin asıl veri sorumlusu satıcıdır (siz); panel bunları sizin adınıza işler.',
        'İşlem kaydı: mağazadaki kullanıcıların yaptığı önemli işlemler (kim, ne zaman, ne yaptı).',
      ] },
      { h: 'Verilerin kullanımı', p: [
        'Veriler yalnızca hizmeti sunmak için kullanılır: pazaryerleriyle eşitleme, kâr hesabı, bildirim e-postaları, güvenlik ve hata giderme.',
        'Verileriniz reklam amacıyla kullanılmaz, satılmaz. Her mağazanın verisi diğer mağazalardan ayrı tutulur.',
      ] },
      { h: 'Hizmet aldığımız altyapı sağlayıcıları', p: [
        'Barındırma: Vercel Inc. (ABD). Veritabanı ve dosya depolama: Supabase Inc. (sunucu bölgesi: [BÖLGE]). E-posta gönderimi: Google (Gmail).',
        'Bu sağlayıcıların sunucuları yurt dışında bulunabilir. Yurt dışına aktarım KVKK\'nın 9. maddesine uygun şekilde yapılır (bkz. KVKK Aydınlatma Metni).',
        'İleride yapay zekâ destekli özet özelliği eklenirse, yalnızca bu özellik açıldığında ilgili özet verileri (kişisel veri içermeyecek şekilde) yapay zekâ sağlayıcısına gönderilir; bu politika güncellenir.',
      ] },
      { h: 'Güvenlik', p: [
        'Bağlantılar HTTPS ile şifrelenir. Şifreler scrypt ile özetlenir, API anahtarları şifreli saklanır. Art arda hatalı girişlerde hesap geçici olarak kilitlenir. Veritabanına yalnızca sunucu erişebilir.',
      ] },
      { h: 'Saklama süresi', p: [
        'Hesap açık kaldığı sürece veriler saklanır. Hesap kapatıldığında, vergi ve ticaret mevzuatının gerektirdiği kayıtlar dışındaki veriler silinir veya anonim hale getirilir.',
      ] },
      { h: 'Çerezler', p: [
        'Yalnızca oturumunuzu açık tutmak için zorunlu bir çerez kullanılır. Reklam veya izleme çerezi kullanılmaz.',
      ] },
      { h: 'İletişim', p: ['Sorularınız ve talepleriniz için: [İLETİŞİM E-POSTASI].'] },
    ],
  },
  kvkk: {
    title: 'KVKK Aydınlatma Metni',
    intro: `6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") 10. maddesi uyarınca, veri sorumlusu sıfatıyla ${OPERATOR} olarak kişisel verilerinizin işlenmesi hakkında sizi bilgilendiririz.`,
    sections: [
      { h: '1. İşlenen kişisel veriler', p: [
        'Kimlik ve iletişim: ad soyad, e-posta adresi. Müşteri işlem: mağaza, ürün, sipariş ve işlem kayıtları. İşlem güvenliği: şifre özeti, IP adresi, giriş zamanları, oturum bilgileri.',
        'Panel, satıcı kullanıcılarımız adına pazaryeri alıcılarının sipariş bilgilerini (ad, teslimat adresi, sipariş içeriği) de işler. Bu verilerde satıcı veri sorumlusu, Hizmet Sağlayıcı veri işleyendir.',
      ] },
      { h: '2. İşleme amaçları', p: [
        'Üyelik ve hesabın oluşturulması, hizmetin sunulması (pazaryeri eşitleme, stok ve sipariş yönetimi, kâr hesabı), bilgi güvenliğinin sağlanması, talep ve şikâyetlerin yanıtlanması, yasal yükümlülüklerin yerine getirilmesi.',
      ] },
      { h: '3. Hukuki sebepler', p: [
        'KVKK m.5/2-c: sözleşmenin kurulması ve ifası; m.5/2-ç: hukuki yükümlülüğün yerine getirilmesi; m.5/2-f: bilgi güvenliği için veri sorumlusunun meşru menfaati.',
      ] },
      { h: '4. Aktarım', p: [
        'Kişisel veriler; hizmetin sunulması için altyapı sağlayıcılarımıza (barındırma: Vercel; veritabanı: Supabase; e-posta: Google) ve sizin talimatınızla bağlandığınız pazaryerlerine aktarılır; yetkili kamu kurumlarına yalnızca kanunen zorunlu hallerde aktarılır.',
        'Altyapı sağlayıcılarının sunucuları yurt dışında bulunabileceğinden, yurt dışına aktarım KVKK m.9 kapsamında [standart sözleşme / açık rıza — HUKUKÇUNUZLA BELİRLEYİN] dayanağıyla yapılır.',
      ] },
      { h: '5. Toplama yöntemi', p: [
        'Veriler, kayıt ve panel formları aracılığıyla elektronik ortamda sizden; sipariş verileri ise API anahtarınızla bağlandığınız pazaryerlerinden otomatik olarak toplanır.',
      ] },
      { h: '6. Haklarınız (KVKK m.11)', p: [
        'Kişisel verinizin işlenip işlenmediğini öğrenme, işlenmişse bilgi talep etme, amacına uygun kullanılıp kullanılmadığını öğrenme, aktarıldığı üçüncü kişileri bilme, eksik/yanlış işlenmişse düzeltilmesini, şartları oluşmuşsa silinmesini isteme, otomatik analiz sonucu aleyhinize bir sonuca itiraz etme ve zarara uğramanız halinde tazminat talep etme haklarına sahipsiniz.',
        'Başvurularınızı [İLETİŞİM E-POSTASI] adresine veya [ADRES] adresine yazılı olarak iletebilirsiniz. Başvurular en geç 30 gün içinde ücretsiz sonuçlandırılır.',
      ] },
    ],
  },
};

export const LEGAL_UPDATED = TERMS_VERSION;
