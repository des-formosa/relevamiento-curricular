-- ============================================================================
-- 16_editar_escuelas.sql — Editar la nómina de escuelas desde el panel
--
-- Hasta acá las escuelas y los departamentos salían solo de la planilla del
-- Ministerio (datos/escuelas.json, generado con datos/generar_escuelas.py), y
-- para corregir un nombre había que pasar por el repositorio. Ahora el equipo
-- los edita en la sección «Escuelas» del panel: corregir nombre, localidad,
-- departamento, tipo, número y CUE; agregar una escuela o un anexo; dar de
-- baja y restaurar; renombrar un departamento.
--
-- Igual que el catálogo, editar no publica. El formulario del docente no lee
-- la base: lee un archivo. «Publicar» llama a exportar_escuelas() y sube
-- escuelas.json al bucket `catalogo` (sql/10); el formulario lo pide primero
-- ahí y, si no está o viene mal, usa datos/escuelas.json del repositorio.
--
-- Los id no cambian nunca: quedan escritos en los aportes. Nada se borra: una
-- escuela dada de baja queda con vigente = false, sus cargas se conservan y
-- deja de ofrecerse al docente.
--
-- Todo cambio queda en escuelas_cambios (qué, antes, después, quién, cuándo).
--
-- Se puede correr más de una vez.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Lo que la base no tenía de la nómina: tipo, CUE y orden
--
-- sql/01 ya los crea en una instalación nueva, y cargar_escuelas() los llena.
-- En una base que ya estaba andando, se completan acá con lo que dice
-- datos/escuelas.json (29/10/2026), solo donde todavía están vacíos.
-- ----------------------------------------------------------------------------

alter table public.escuelas
  add column if not exists tipo  text,
  add column if not exists cue   text,
  add column if not exists orden integer;
alter table public.departamentos
  add column if not exists orden integer;

update public.escuelas e
   set tipo  = coalesce(e.tipo, v.tipo),
       cue   = coalesce(e.cue, v.cue),
       orden = coalesce(e.orden, v.orden)
  from (values
('epes-1', 'EPES', '340005600', 1),
  ('epes-2', 'EPES', '340067500', 2),
  ('anexo-el-corralito', 'ANEXO RURAL', '340103600', 3),
  ('anexo-9-de-julio', 'ANEXO RURAL', '340103601', 4),
  ('epes-3', 'EPES', '340040100', 5),
  ('anexo-el-silencio', 'ANEXO RURAL', '340100200', 6),
  ('anexo-a-flores', 'ANEXO RURAL', '340100201', 7),
  ('anexo-ensanche', 'ANEXO EIB', '340101400', 8),
  ('anexo-lago-verde', 'ANEXO RURAL', '340101500', 9),
  ('anexo-juanita', 'ANEXO RURAL', '340101501', 10),
  ('anexo-el-catorce', 'ANEXO RURAL', '340101502', 11),
  ('anexo-la-preferida', 'ANEXO RURAL', '340101503', 12),
  ('epes-4', 'EPES', '340062100', 13),
  ('anexo-juan-b-alberdi', 'ANEXO EIB', '340108000', 14),
  ('anexo-pozo-largo', 'ANEXO RURAL', '340108900', 15),
  ('anexo-las-choyas', 'ANEXO RURAL', '340110700', 16),
  ('anexo-campo-alegre', 'ANEXO RURAL', '340101600', 17),
  ('epes-6', 'EPES', '340040700', 18),
  ('anexo-cacique-coquero', 'ANEXO EIB', '340101300', 19),
  ('anexo-villa-gral-urquiza', 'ANEXO EIB', '340101301', 20),
  ('anexo-qompi-juan-sosa', 'ANEXO EIB', '340109000', 21),
  ('anexo-laka-wichi', 'ANEXO EIB', '340111900', 22),
  ('epes-8', 'EPES', '340038700', 23),
  ('anexo-villa-real', 'ANEXO RURAL', '340102000', 24),
  ('anexo-loro-cue', 'ANEXO RURAL', '340102001', 25),
  ('epes-9', 'EPES', '340052600', 26),
  ('anexo-el-comienzo', 'ANEXO RURAL', '340103200', 27),
  ('epes-10', 'EPES', '340019900', 28),
  ('epes-11', 'EPES', '340009600', 29),
  ('epes-12', 'EPES', '340057600', 30),
  ('anexo-el-totoral', 'ANEXO RURAL', '340099400', 31),
  ('anexo-la-junta', 'ANEXO RURAL', '340099401', 32),
  ('anexo-el-milagro', 'ANEXO RURAL', '340099402', 33),
  ('epes-13', 'EPES', '340050000', 34),
  ('anexo-los-tres-reyes', 'ANEXO RURAL', '340100400', 35),
  ('anexo-fortin-sto-1-leyes', 'ANEXO RURAL', '340100403', 36),
  ('anexo-el-pavao', 'ANEXO RURAL', '340100401', 37),
  ('anexo-las-lolas', 'ANEXO RURAL', '340100402', 38),
  ('anexo-santa-rosa-340100404', 'ANEXO RURAL', '340100404', 39),
  ('anexo-union-escuela', 'ANEXO RURAL', '340100405', 40),
  ('anexo-ceferino-namuncura', 'ANEXO EIB', '340100406', 41),
  ('anexo-san-isidro-340100700', 'ANEXO RURAL', '340100700', 42),
  ('epes-14', 'EPES', '340053200', 43),
  ('epes-15', 'EPES', '340048300', 44),
  ('epes-16', 'EPES', '340015300', 45),
  ('epes-17', 'EPES', '340052300', 46),
  ('anexo-el-recreo', 'ANEXO RURAL', '340107600', 47),
  ('epes-18', 'EPES', '340032400', 48),
  ('epes-19', 'EPES', '340019100', 49),
  ('anexo-paso-angelito', 'ANEXO EIB', '340102100', 50),
  ('anexo-la-primavera', 'ANEXO RURAL', '340102300', 51),
  ('anexo-isla-puen', 'ANEXO RURAL', '340102301', 52),
  ('anexo-los-santafesinos', 'ANEXO RURAL', '340103000', 53),
  ('anexo-lucero-cue', 'ANEXO RURAL', '340103001', 54),
  ('epes-20', 'EPES', '340043100', 55),
  ('epes-21', 'EPES', '340003300', 56),
  ('anexo-laguna-toro', 'ANEXO RURAL', '340101700', 57),
  ('anexo-colonia-nueva', 'ANEXO RURAL', '340101701', 58),
  ('epes-22', 'EPES', '340002700', 59),
  ('anexo-jose-m-paz', 'ANEXO RURAL', '340102900', 60),
  ('epes-23', 'EPES', '340022100', 61),
  ('anexo-san-jose', 'ANEXO RURAL', '340104200', 62),
  ('anexo-san-isidro-340104201', 'ANEXO RURAL', '340104201', 63),
  ('anexo-el-timbo', 'ANEXO RURAL', '340104300', 64),
  ('anexo-la-estrella', 'ANEXO RURAL', '340105400', 65),
  ('epes-25', 'EPES', '340061900', 66),
  ('anexo-el-quemado', 'ANEXO RURAL', '340098900', 67),
  ('anexo-el-canon', 'ANEXO RURAL', '340099100', 68),
  ('anexo-pozo-del-mortero', 'ANEXO RURAL', '340099200', 69),
  ('epes-26', 'EPES', '340035200', 70),
  ('anexo-acceso-gran-guardia', 'ANEXO RURAL', '340103702', 71),
  ('anexo-la-lomita', 'ANEXO RURAL', '340103703', 72),
  ('epes-27', 'EPES', '340066000', 73),
  ('epes-28', 'EPES', '340070200', 74),
  ('epes-29', 'EPES', '340071600', 75),
  ('anexo-colonia-aborigen', 'ANEXO EIB', '340108300', 76),
  ('epes-30', 'EPES', '340046600', 77),
  ('epes-31', 'EPES', '340059100', 78),
  ('epes-32', 'EPES', '340043000', 79),
  ('epes-33', 'EPES', '340049600', 80),
  ('epes-34', 'EPES', '340050600', 81),
  ('anexo-marca-m', 'ANEXO RURAL', '340050601', 82),
  ('anexo-sol-de-mayo', 'ANEXO RURAL', '340050602', 83),
  ('anexo-colonia-sudamericana', 'ANEXO RURAL', '340050603', 84),
  ('epes-35', 'EPES', '340051300', 85),
  ('epes-36', 'EPES', '340045300', 86),
  ('anexo-el-paraiso', 'ANEXO RURAL', '340102400', 87),
  ('anexo-presidente-avellaneda', 'ANEXO RURAL', '340102401', 88),
  ('anexo-san-juan', 'ANEXO RURAL', '340102800', 89),
  ('anexo-colonia-san-juan', 'ANEXO RURAL', '340102801', 90),
  ('epes-37', 'EPES', '340054800', 91),
  ('anexo-juan-g-bazan', 'ANEXO RURAL', '340100000', 92),
  ('anexo-fortin-soledad', 'ANEXO RURAL', '340100100', 93),
  ('anexo-javier-muniz', 'ANEXO EIB', '340100900', 94),
  ('anexo-teniente-brown', 'ANEXO RURAL', '340100901', 95),
  ('anexo-tres-pozos', 'ANEXO EIB', '340101200', 96),
  ('anexo-campo-del-cielo', 'ANEXO EIB', '340108500', 97),
  ('anexo-punta-del-agua', 'ANEXO RURAL', '340101300', 98),
  ('epes-38', 'EPES', '340078100', 99),
  ('anexo-potrero-nandu', 'ANEXO RURAL', '340103300', 100),
  ('anexo-el-bosquecillo', 'ANEXO RURAL', '340103301', 101),
  ('anexo-lote-11', 'ANEXO RURAL', '340103302', 102),
  ('anexo-el-coati', 'ANEXO RURAL', '340103400', 103),
  ('epes-39', 'EPES', '340064200', 104),
  ('anexo-pozo-molina', 'ANEXO EIB', '340117500', 105),
  ('anexo-guadalcazar', 'ANEXO RURAL', '340099500', 106),
  ('anexo-fortin-la-madrid', 'ANEXO RURAL', '340099501', 107),
  ('anexo-la-zanja', 'ANEXO RURAL', '340103900', 108),
  ('anexo-la-libertad', 'ANEXO RURAL', '340103901', 109),
  ('anexo-alto-alegre', 'ANEXO RURAL', '340104000', 110),
  ('anexo-el-solitario', 'ANEXO RURAL', '340106900', 111),
  ('anexo-rio-muerto', 'ANEXO RURAL', '340106901', 112),
  ('anexo-la-esperanza', 'ANEXO EIB', '340117500', 113),
  ('anexo-el-descanso', 'ANEXO EIB', '340117500', 114),
  ('epes-40', 'EPES', '340063900', 115),
  ('anexo-kilometro-15', 'ANEXO RURAL', '340063901', 116),
  ('anexo-santa-rosa-340063902', 'ANEXO RURAL', '340063902', 117),
  ('anexo-san-martin-1', 'ANEXO RURAL', '340104100', 118),
  ('anexo-el-ceibal', 'ANEXO RURAL', '340104101', 119),
  ('anexo-chico-dawagan', 'ANEXO EIB', '340105600', 120),
  ('epes-41', 'EPES', '340046500', 121),
  ('epes-42', 'EPES', '340001500', 122),
  ('epes-43', 'EPES', '340022700', 123),
  ('epes-44', 'EPES', '340042100', 124),
  ('anexo-casco-cue', 'ANEXO RURAL', '340103700', 125),
  ('anexo-el-guajo', 'ANEXO RURAL', '340103701', 126),
  ('anexo-centro-forestal', 'ANEXO RURAL', '340107900', 127),
  ('epes-45', 'EPES', '340067000', 128),
  ('anexo-esterito', 'ANEXO RURAL', '340099600', 129),
  ('anexo-ituzaingo', 'ANEXO RURAL', '340099601', 130),
  ('epes-46', 'EPES', '340036800', 131),
  ('anexo-villa-trinidad', 'ANEXO RURAL', '340107500', 132),
  ('epes-47', 'EPES', '340068200', 133),
  ('anexo-km-128', 'ANEXO RURAL', '340105202', 134),
  ('epes-49', 'EPES', '340045800', 135),
  ('epes-50', 'EPES', '340043400', 136),
  ('anexo-la-pantalla', 'ANEXO EIB', '340101000', 137),
  ('anexo-lote-27', 'ANEXO EIB', '340101001', 138),
  ('anexo-lote-47', 'ANEXO EIB', '340101002', 139),
  ('anexo-laqtasatanyie-km-14', 'ANEXO EIB', '340101100', 140),
  ('anexo-la-bomba', 'ANEXO EIB', '340101101', 141),
  ('epes-51', 'EPES', '340037100', 142),
  ('epes-52', 'EPES', '340039400', 143),
  ('epes-53', 'EPES', '340078200', 144),
  ('anexo-el-piquete', 'ANEXO RURAL', '340102601', 145),
  ('anexo-pilagas-iii', 'ANEXO RURAL', '340102602', 146),
  ('anexo-santa-cruz', 'ANEXO RURAL', '340103100', 147),
  ('anexo-para-todos', 'ANEXO RURAL', '340103101', 148),
  ('anexo-loma-alberdi', 'ANEXO RURAL', '340103102', 149),
  ('epes-54', 'EPES', '340080600', 150),
  ('epes-55', 'EPES', '340024200', 151),
  ('anexo-boca-de-pilagas', 'ANEXO RURAL', '340100500', 152),
  ('anexo-guaycolec', 'ANEXO RURAL', '340100501', 153),
  ('anexo-dalmacia', 'ANEXO RURAL', '340100502', 154),
  ('anexo-isla-25-de-mayo', 'ANEXO RURAL', '340100503', 155),
  ('anexo-banco-la-emilia', 'ANEXO RURAL', '340100504', 156),
  ('epes-56', 'EPES', '340080700', 157),
  ('epes-57', 'EPES', '340080800', 158),
  ('epes-58', 'EPES', '340080600', 159),
  ('epes-59', 'EPES', '340084300', 160),
  ('epes-60', 'EPES', '340084400', 161),
  ('epes-61', 'EPES', '340085400', 162),
  ('epes-62', 'EPES', '340085600', 163),
  ('anexo-potrero-de-los-caballos', 'ANEXO RURAL', '340099800', 164),
  ('anexo-riacho-lindo', 'ANEXO RURAL', '340099801', 165),
  ('anexo-banco-payagua', 'ANEXO RURAL', '340099900', 166),
  ('anexo-el-angelito', 'ANEXO RURAL', '340107700', 167),
  ('epes-63', 'EPES', '340085700', 168),
  ('anexo-villa-rural', 'ANEXO RURAL', '340101800', 169),
  ('anexo-isla-azul', 'ANEXO RURAL', '340101801', 170),
  ('epes-64', 'EPES', '340085800', 171),
  ('anexo-apayerey', 'ANEXO RURAL', '340107800', 172),
  ('epes-65', 'EPES', '340085900', 173),
  ('epes-66', 'EPES', '340086000', 174),
  ('anexo-la-rinconada', 'ANEXO RURAL', '340099000', 175),
  ('epes-67', 'EPES', '340086100', 176),
  ('epes-68', 'EPES', '340086200', 177),
  ('epes-69', 'EPES', '340086400', 178),
  ('epes-n-69-a-i-cbso-epep-n-372', 'ANEXO EPES EIB', '340086401', 179),
  ('epes-70', 'EPES', '340042900', 180),
  ('anexo-san-isidro-340100800', 'ANEXO RURAL', '340100800', 181),
  ('epes-71', 'EPES', '340014400', 182),
  ('anexo-san-carlos', 'ANEXO EIB', '340014402', 183),
  ('anexo-la-media-luna', 'ANEXO RURAL', '340014403', 184),
  ('anexo-riacho-de-oro', 'ANEXO EIB', '340014402', 185),
  ('anexo-el-divisadero', 'ANEXO RURAL', '340108100', 186),
  ('anexo-san-roque', 'ANEXO RURAL', '340108400', 187),
  ('epes-72', 'EPES', '340087300', 188),
  ('epes-73', 'EPES', '340091900', 189),
  ('epes-74', 'EPES', '340092000', 190),
  ('epes-77', 'EPES', '340092300', 191),
  ('epes-78', 'EPES', '340092400', 192),
  ('epes-80', 'EPES', '340092600', 193),
  ('epes-81', 'EPES', '340092900', 194),
  ('epes-82', 'EPES', '340094200', 195),
  ('epes-83', 'EPES', '340093500', 196),
  ('anexo-garcete-cue', 'ANEXO RURAL', '340099300', 197),
  ('anexo-puerto-pilcomayo', 'ANEXO RURAL', '340099301', 198),
  ('anexo-isla-apando', 'ANEXO RURAL', '340099302', 199),
  ('anexo-buey-muerto', 'ANEXO RURAL', '340099303', 200),
  ('epes-84', 'EPES', '340097000', 201),
  ('epes-87', 'EPES', '340097200', 202),
  ('epes-88', 'EPES', '340096900', 203),
  ('epes-89', 'EPES', '340106800', 204),
  ('epes-90', 'EPES', '340109900', 205),
  ('epes-91', 'EPES', '340109500', 206),
  ('epes-92', 'EPES', '340110000', 207),
  ('epes-93', 'EPES', '340110100', 208),
  ('epes-94', 'EPES', '340110200', 209),
  ('epes-95', 'EPES', '340110300', 210),
  ('epes-96', 'EPES', '340110400', 211),
  ('epes-97', 'EPES', '340110500', 212),
  ('epes-98', 'EPES', '340110800', 213),
  ('epes-99', 'EPES', '340116200', 214),
  ('epes-100', 'EPES', '340058500', 215),
  ('epes-101', 'EPES', '340111100', 216),
  ('anexo-el-desaguadero', 'ANEXO EIB', '340111101', 217),
  ('epes-102', 'EPES', '340103800', 218),
  ('epes-103', 'EPES', '340121900', 219),
  ('epes-105', 'EPES', '340115700', 220),
  ('epes-eib-1', 'EPES EIB', '340049700', 221),
  ('epes-eib-2', 'EPES EIB', '340105500', 222),
  ('epes-eib-n-2-a-viii-epep-n-470', 'ANEXO EPES EIB', '340044308', 223),
  ('epes-eib-n-2-a-vii-epep-n-383', 'ANEXO EPES EIB', '340044307', 224),
  ('epes-eib-3', 'EPES EIB', '340065100', 225),
  ('anexo-pozo-de-los-patos', 'ANEXO EIB', '340065103', 226),
  ('anexo-el-mistolar', 'ANEXO EIB', '340065104', 227),
  ('anexo-el-potrerito', 'ANEXO RURAL', '340065105', 228),
  ('anexo-pozo-el-yacare', 'ANEXO EIB', '340065107', 229),
  ('anexo-campo-grande', 'ANEXO RURAL', '340065108', 230),
  ('anexo-bolsa-del-palomo', 'ANEXO RURAL', '340065109', 231),
  ('anexo-campo-bandera', 'ANEXO EIB', '340065112', 232),
  ('epes-eib-n-3-anexo-11', 'EPES EIB', '340065111', 233),
  ('epes-eib-5', 'EPES EIB', '340092100', 234),
  ('a-e-i-b-el-breal-epep-n-477', 'ANEXO EPES EIB', '340092102', 235),
  ('epes-eib-n-13-lote-8', 'ANEXO EPES EIB', '340092101', 236),
  ('epes-eib-n-13-a-1-palmarcito-epep-n-384', 'ANEXO EPES EIB', '340092103', 237),
  ('epes-eib-n-13-a-pozo-la-chiva-epep-n-455', 'ANEXO EPES EIB', '340092104', 238),
  ('epes-eib-6', 'EPES EIB', '340097300', 239),
  ('anexo-los-jubilados', 'ANEXO EIB', '340097301', 240),
  ('anexo-campo-aviacion', 'ANEXO EIB', '340097302', 241),
  ('epes-eib-8', 'EPES EIB', '340105500', 242),
  ('epes-eib-9', 'EPES EIB', '340111300', 243),
  ('epes-eib-n-9-anexo-1-epep-n-465', 'ANEXO EPES EIB', '340111301', 244),
  ('epes-eib-n-9-anexo-2-epep-n-456', 'ANEXO EPES EIB', '340111302', 245),
  ('epes-eib-n-9-anexo-3-epep-n-439', 'ANEXO EPES EIB', '340111303', 246),
  ('epes-eib-10', 'EPES EIB', '340115400', 247),
  ('epes-eib-11', 'EPES EIB', '340118300', 248),
  ('epes-eib-12', 'EPES EIB', '340116900', 249),
  ('epes-eib-n-12-a-i-epep-n-475', 'ANEXO EPES EIB', '340116901', 250),
  ('epes-eib-14', 'EPES EIB', '340117100', 251),
  ('epes-agraria-1', 'EPES AGRARIA', '340117700', 252),
  ('epes-agraria-n-1-anexo-1-epep-n-296', 'ANEXO AGRARIA', '340117701', 253),
  ('epes-agraria-n-1-anexo-2-epep-n-298', 'ANEXO AGRARIA', '340117702', 254),
  ('epes-agraria-n-1-anexo-3-epep-n-488', 'ANEXO AGRARIA', '340117703', 255),
  ('epes-agraria-n-1-anexo-4-epep-n-366', 'ANEXO AGRARIA', '340117704', 256),
  ('epes-agraria-n-1-anexo-5-epep-n-125', 'ANEXO AGRARIA', '340117705', 257),
  ('epes-agraria-2', 'EPES AGRARIA', '340117800', 258),
  ('epes-agraria-n-2-anexo-1-epep-n-202', 'ANEXO AGRARIA', '340117801', 259),
  ('epes-agraria-n-2-anexo-4-epep-n-229', 'ANEXO AGRARIA', '340117804', 260),
  ('epes-agraria-n-2-anexo-6-epep-n-286', 'ANEXO AGRARIA', '340117806', 261),
  ('epes-agraria-n-2-anexo-3-epep-n-226', 'ANEXO AGRARIA', '340117803', 262),
  ('epes-agraria-n-2-anexo-5-epep-n-233', 'ANEXO AGRARIA', '340117805', 263),
  ('epes-agraria-n-2-anexo-9-epep-n-381', 'ANEXO AGRARIA', '340117809', 264),
  ('epes-agraria-n-2-anexo-8-epep-n-351', 'ANEXO AGRARIA', '340117808', 265),
  ('epes-agraria-n-2-anexo-2-epep-n-206', 'ANEXO AGRARIA', '340117802', 266),
  ('epes-agraria-n-2-anexo-7-epep-n-349', 'ANEXO AGRARIA', '340117807', 267),
  ('epes-agraria-3', 'EPES AGRARIA', '340117900', 268),
  ('epes-agraria-n-3-anexo-1-epep-n-60', 'ANEXO AGRARIA', '340117901', 269),
  ('epes-agraria-n-3-anexo-2-epep-n-247', 'ANEXO AGRARIA', '340117902', 270),
  ('epes-agraria-n-3-anexo-3-epep-n-517-anexo-i', 'ANEXO AGRARIA', '340117903', 271),
  ('epes-agraria-n-3-anexo-4-epep-n-517-anexo-ii', 'ANEXO AGRARIA', '340117904', 272),
  ('epes-agraria-4', 'EPES AGRARIA', '340118000', 273),
  ('epes-agraria-n-4-anexo-1-epep-n-47', 'ANEXO AGRARIA', '340118001', 274),
  ('epes-agraria-n-4-anexo-2-epep-n-112', 'ANEXO AGRARIA', '340118002', 275),
  ('epes-agraria-n-4-anexo-3-epep-n-157', 'ANEXO AGRARIA', '340118003', 276),
  ('epes-agraria-n-4-anexo-4-epep-n-184', 'ANEXO AGRARIA', '340118004', 277),
  ('epes-agraria-n-4-anexo-5-epep-n-323', 'ANEXO AGRARIA', '340118005', 278),
  ('epes-agraria-n-4-anexo-6-epep-n-466', 'ANEXO AGRARIA', '340118006', 279),
  ('epes-agraria-5', 'EPES AGRARIA', '340118100', 280),
  ('epes-agraria-n-5-anexo-1-epep-n-177', 'ANEXO AGRARIA', '340118101', 281),
  ('epes-agraria-n-5-anexo-2-epep-n-205', 'ANEXO AGRARIA', '340118102', 282),
  ('epes-agraria-n-5-anexo-3-epep-n-511', 'ANEXO EIB  AGRARIA', '340118103', 283),
  ('epes-agraria-6', 'EPES AGRARIA', '340118200', 284),
  ('epes-agraria-n-6-anexo-1-epep-n-39', 'ANEXO AGRARIA', '340118201', 285),
  ('epes-agraria-n-6-anexo-2-epep-n-70', 'ANEXO AGRARIA', '340118202', 286),
  ('epes-agraria-n-6-anexo-3-epep-n-119', 'ANEXO AGRARIA', '340118203', 287),
  ('epes-agraria-n-6-anexo-4-epep-n-317', 'ANEXO AGRARIA', '340118204', 288)
  ) as v (id, tipo, cue, orden)
 where e.id = v.id;

update public.departamentos d
   set orden = coalesce(d.orden, v.orden)
  from (values
  ('formosa', 1),
  ('pilcomayo', 2),
  ('pirane', 3),
  ('patino', 4),
  ('bermejo', 5),
  ('matacos', 6),
  ('ramon-lista', 7),
  ('pilagas', 8),
  ('laishi', 9)
  ) as v (id, orden)
 where d.id = v.id;


-- ----------------------------------------------------------------------------
-- 2. Historial y publicaciones
-- ----------------------------------------------------------------------------

create table if not exists public.escuelas_cambios (
  id               bigserial primary key,
  escuela_id       text references public.escuelas (id),
  departamento_id  text references public.departamentos (id),
  accion           text not null check (accion in ('alta', 'edicion', 'baja', 'restauracion', 'departamento')),
  antes            jsonb,
  despues          jsonb,
  usuario_id       uuid references auth.users (id) on delete set null,
  momento          timestamptz not null default now()
);
create index if not exists escuelas_cambios_momento_idx on public.escuelas_cambios (momento desc);

create table if not exists public.escuelas_publicaciones (
  id           bigserial primary key,
  momento      timestamptz not null default now(),
  usuario_id   uuid,
  escuelas     integer not null
);

alter table public.escuelas_cambios       enable row level security;
alter table public.escuelas_publicaciones enable row level security;
revoke all on public.escuelas_cambios       from anon, authenticated;
revoke all on public.escuelas_publicaciones from anon, authenticated;
grant select on public.escuelas_cambios       to authenticated;
grant select on public.escuelas_publicaciones to authenticated;

drop policy if exists "equipo lee" on public.escuelas_cambios;
create policy "equipo lee" on public.escuelas_cambios
  for select to authenticated using ((select public.es_equipo()));
drop policy if exists "equipo lee" on public.escuelas_publicaciones;
create policy "equipo lee" on public.escuelas_publicaciones
  for select to authenticated using ((select public.es_equipo()));


-- Lo que se guarda de una escuela en el historial
create or replace function public.foto_escuela(p_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('nombre', e.nombre, 'localidad', e.localidad, 'departamento_id', e.departamento_id,
                            'tipo', e.tipo, 'numero', e.numero, 'cue', e.cue, 'vigente', e.vigente)
    from public.escuelas e where e.id = p_id;
$$;

-- Un anexo: lo dice el tipo, o el nombre («E.P.E.S. E.I.B. N° 3 Anexo 11»
-- viene rotulada como E.P.E.S. en la nómina)
create or replace function public.es_anexo(p_tipo text, p_nombre text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_tipo, '') ilike 'ANEXO%' or coalesce(p_nombre, '') ~* '\manexo\M';
$$;


-- ----------------------------------------------------------------------------
-- 3. guardar_escuela(...) — corrige una (p_id) o agrega una nueva (p_id null)
--
--   supabase.rpc('guardar_escuela', { p_id: 'epes-2', p_nombre: 'E.P.E.S. N° 2',
--     p_localidad: 'Pirané', p_departamento_id: 'pirane', p_tipo: 'EPES',
--     p_numero: '2', p_cue: '340067500', p_despues_de: null })
--
-- Al agregar, p_despues_de dice dónde va en la nómina: un anexo, después de su
-- sede y de los anexos que ya tiene (así la sede se deduce sola); sin
-- p_despues_de, al final de su departamento.
-- Devuelve la escuela como quedó, o { error } con un mensaje para mostrar.
-- ----------------------------------------------------------------------------

create or replace function public.guardar_escuela(
  p_id               text,
  p_nombre           text,
  p_localidad        text,
  p_departamento_id  text,
  p_tipo             text,
  p_numero           text,
  p_cue              text,
  p_despues_de       text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nombre     text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_localidad  text := nullif(regexp_replace(btrim(coalesce(p_localidad, '')), '\s+', ' ', 'g'), '');
  v_tipo       text := upper(regexp_replace(btrim(coalesce(p_tipo, '')), '\s+', ' ', 'g'));
  v_numero     text := nullif(btrim(coalesce(p_numero, '')), '');
  v_cue        text := nullif(regexp_replace(coalesce(p_cue, ''), '\D', '', 'g'), '');
  v_norm       text;
  v_antes      jsonb;
  v_id         text;
  v_base       text;
  v_n          integer := 1;
  v_orden      integer;
  v_desde      integer;
begin
  if not public.es_equipo() then
    return jsonb_build_object('error', 'Tu usuario no puede editar escuelas.');
  end if;
  v_norm := public.normalizar_texto(v_nombre);
  if v_norm = '' then
    return jsonb_build_object('error', 'Escribí el nombre de la escuela.');
  end if;
  if char_length(v_nombre) > 200 or char_length(coalesce(v_localidad, '')) > 100 then
    return jsonb_build_object('error', 'El nombre o la localidad son demasiado largos.');
  end if;
  if not exists (select 1 from public.departamentos where id = p_departamento_id) then
    return jsonb_build_object('error', 'Elegí el departamento.');
  end if;
  if v_tipo = '' then
    return jsonb_build_object('error', 'Elegí el tipo de escuela.');
  end if;
  if v_numero is not null and v_numero !~ '^[0-9]{1,4}$' then
    return jsonb_build_object('error', 'El número de la escuela son solo números (por ejemplo 41).');
  end if;
  if v_cue is not null and v_cue !~ '^[0-9]{9}$' then
    return jsonb_build_object('error', 'El CUE tiene 9 números (por ejemplo 340067500).');
  end if;
  if exists (select 1 from public.escuelas e
              where e.origen = 'oficial' and e.vigente and e.departamento_id = p_departamento_id
                and e.nombre_normalizado = v_norm and e.id is distinct from p_id) then
    return jsonb_build_object('error', 'Ya hay una escuela con ese nombre en ese departamento.');
  end if;

  if p_id is not null then
    select public.foto_escuela(e.id) into v_antes from public.escuelas e where e.id = p_id and e.origen = 'oficial';
    if v_antes is null then
      return jsonb_build_object('error', 'No encontramos esa escuela en la nómina. Las que escribieron los docentes se corrigen en Seguimiento, «Agregadas por docentes».');
    end if;
    update public.escuelas
       set nombre = v_nombre, nombre_normalizado = v_norm, localidad = v_localidad,
           departamento_id = p_departamento_id, tipo = v_tipo, numero = v_numero, cue = v_cue
     where id = p_id;
    if public.foto_escuela(p_id) is distinct from v_antes then
      insert into public.escuelas_cambios (escuela_id, accion, antes, despues, usuario_id)
      values (p_id, 'edicion', v_antes, public.foto_escuela(p_id), (select auth.uid()));
    end if;
    return public.foto_escuela(p_id) || jsonb_build_object('id', p_id);
  end if;

  -- Alta: el id sale del nombre, como en generar_escuelas.py, y no se repite
  v_base := case
    when v_numero is not null and not public.es_anexo(v_tipo, v_nombre) and v_tipo like 'EPES%EIB%' then 'epes-eib-' || v_numero
    when v_numero is not null and not public.es_anexo(v_tipo, v_nombre) and v_tipo like 'EPES%AGRARIA%' then 'epes-agraria-' || v_numero
    when v_numero is not null and not public.es_anexo(v_tipo, v_nombre) and v_tipo = 'EPES' then 'epes-' || v_numero
    -- «Anexo de Educación Rural – El Corralito» → anexo-el-corralito
    else regexp_replace(replace(v_norm, ' ', '-'), '^anexo-de-educacion-(rural|intercultural-bilingue)-', 'anexo-')
  end;
  v_id := v_base;
  while exists (select 1 from public.escuelas where id = v_id) loop
    v_n := v_n + 1;
    v_id := v_base || '-' || v_n;
  end loop;

  -- Dónde va en la nómina
  if p_despues_de is not null then
    select e.orden into v_desde from public.escuelas e where e.id = p_despues_de;
    if v_desde is null then
      return jsonb_build_object('error', 'No encontramos la escuela de la que depende. Volvé a abrir la sección.');
    end if;
    -- Después de la sede y de los anexos que la siguen: antes de la próxima E.P.E.S.
    select min(e.orden) into v_orden from public.escuelas e
     where e.origen = 'oficial' and e.orden > v_desde and not public.es_anexo(e.tipo, e.nombre);
  else
    select max(e.orden) + 1 into v_orden from public.escuelas e
     where e.origen = 'oficial' and e.departamento_id = p_departamento_id;
  end if;
  if v_orden is null then
    select coalesce(max(e.orden), 0) + 1 into v_orden from public.escuelas e where e.origen = 'oficial';
  end if;
  update public.escuelas set orden = orden + 1 where origen = 'oficial' and orden >= v_orden;

  insert into public.escuelas (id, departamento_id, numero, denominacion, nombre, localidad,
                               nombre_normalizado, origen, tipo, cue, orden, vigente)
  values (v_id, p_departamento_id, v_numero, '', v_nombre, v_localidad, v_norm, 'oficial', v_tipo, v_cue, v_orden, true);
  insert into public.escuelas_cambios (escuela_id, accion, despues, usuario_id)
  values (v_id, 'alta', public.foto_escuela(v_id), (select auth.uid()));
  return public.foto_escuela(v_id) || jsonb_build_object('id', v_id);
end;
$$;


-- ----------------------------------------------------------------------------
-- 4. Dar de baja y restaurar
--
-- Dar de baja no borra: la escuela queda con vigente = false, conserva sus
-- cargas y deja de ofrecerse a los docentes (al publicar). Devuelve cuántas
-- cargas tiene, para que la pantalla lo diga.
-- ----------------------------------------------------------------------------

create or replace function public.cambiar_vigencia_escuela(p_id text, p_vigente boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes jsonb;
begin
  if not public.es_equipo() then
    return jsonb_build_object('error', 'Tu usuario no puede editar escuelas.');
  end if;
  select public.foto_escuela(e.id) into v_antes from public.escuelas e where e.id = p_id and e.origen = 'oficial';
  if v_antes is null then
    return jsonb_build_object('error', 'No encontramos esa escuela en la nómina.');
  end if;
  update public.escuelas set vigente = p_vigente where id = p_id;
  if (v_antes ->> 'vigente')::boolean is distinct from p_vigente then
    insert into public.escuelas_cambios (escuela_id, accion, antes, despues, usuario_id)
    values (p_id, case when p_vigente then 'restauracion' else 'baja' end, v_antes, public.foto_escuela(p_id), (select auth.uid()));
  end if;
  return jsonb_build_object('id', p_id, 'vigente', p_vigente,
    'cargas', (select count(*) from public.aportes a where a.escuela_id = p_id and not a.es_ejemplo));
end;
$$;


-- ----------------------------------------------------------------------------
-- 5. guardar_departamento(id, nombre) — renombrarlo (el id no cambia)
-- ----------------------------------------------------------------------------

create or replace function public.guardar_departamento(p_id text, p_nombre text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nombre text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_antes  text;
begin
  if not public.es_equipo() then
    return jsonb_build_object('error', 'Tu usuario no puede editar departamentos.');
  end if;
  select d.nombre into v_antes from public.departamentos d where d.id = p_id;
  if v_antes is null then
    return jsonb_build_object('error', 'No encontramos ese departamento.');
  end if;
  if v_nombre = '' or char_length(v_nombre) > 60 then
    return jsonb_build_object('error', 'Escribí el nombre del departamento (hasta 60 letras).');
  end if;
  if exists (select 1 from public.departamentos d where d.id <> p_id and public.normalizar_texto(d.nombre) = public.normalizar_texto(v_nombre)) then
    return jsonb_build_object('error', 'Ya hay otro departamento con ese nombre.');
  end if;
  update public.departamentos set nombre = v_nombre where id = p_id;
  if v_antes is distinct from v_nombre then
    insert into public.escuelas_cambios (departamento_id, accion, antes, despues, usuario_id)
    values (p_id, 'departamento', jsonb_build_object('nombre', v_antes), jsonb_build_object('nombre', v_nombre), (select auth.uid()));
  end if;
  return jsonb_build_object('id', p_id, 'nombre', v_nombre);
end;
$$;


-- ----------------------------------------------------------------------------
-- 6. Publicar
--
-- exportar_escuelas() arma el escuelas.json que lee el formulario: los
-- departamentos y las escuelas oficiales vigentes, en el orden de la nómina,
-- con los mismos campos que datos/escuelas.json (el índice de búsqueda lo arma
-- el navegador). El panel lo sube al bucket y anota la publicación.
-- ----------------------------------------------------------------------------

create or replace function public.exportar_escuelas()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.es_equipo() then
    return jsonb_build_object('error', 'Tu usuario no puede publicar la nómina.');
  end if;
  return jsonb_build_object(
    'fuente', 'Panel ReSaP (sección Escuelas)',
    'departamentos', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'nombre', d.nombre)
                                                 order by d.orden nulls last, d.nombre), '[]'::jsonb)
                        from public.departamentos d),
    'escuelas', (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', e.id, 'numero', coalesce(e.numero, ''), 'denominacion', coalesce(e.denominacion, ''),
                          'nombre', e.nombre, 'localidad', coalesce(e.localidad, ''),
                          'departamento_id', e.departamento_id, 'tipo', coalesce(e.tipo, 'EPES'),
                          'cue', coalesce(e.cue, ''), 'orden', e.orden)
                        order by e.orden nulls last, e.nombre), '[]'::jsonb)
                   from public.escuelas e
                  where e.origen = 'oficial' and e.vigente));
end;
$$;

create or replace function public.registrar_publicacion_escuelas(p_escuelas integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.es_equipo() then
    return jsonb_build_object('error', 'Tu usuario no puede publicar la nómina.');
  end if;
  insert into public.escuelas_publicaciones (usuario_id, escuelas) values ((select auth.uid()), p_escuelas);
  return jsonb_build_object('ok', true);
end;
$$;

-- Cuándo se publicó por última vez, quién, y cuántos cambios hay desde entonces
create or replace function public.estado_escuelas()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ultima as (
    select momento, usuario_id, escuelas from public.escuelas_publicaciones order by momento desc limit 1
  )
  select case when not public.es_equipo() then '{}'::jsonb else
    jsonb_build_object(
      'publicado_en',  (select momento from ultima),
      'publicado_por', (select coalesce((select nullif(btrim(ep.nombre), '') from public.equipo_planificacion ep
                                          where ep.usuario_id = ultima.usuario_id), 'alguien del equipo') from ultima),
      'cambios_sin_publicar', (select count(*) from public.escuelas_cambios c
                                where c.momento > coalesce((select momento from ultima), '-infinity'::timestamptz)))
  end;
$$;

revoke execute on function public.guardar_escuela(text, text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.cambiar_vigencia_escuela(text, boolean) from public, anon;
revoke execute on function public.guardar_departamento(text, text) from public, anon;
revoke execute on function public.exportar_escuelas() from public, anon;
revoke execute on function public.registrar_publicacion_escuelas(integer) from public, anon;
revoke execute on function public.estado_escuelas() from public, anon;
revoke execute on function public.foto_escuela(text) from public, anon, authenticated;
grant  execute on function public.guardar_escuela(text, text, text, text, text, text, text, text) to authenticated;
grant  execute on function public.cambiar_vigencia_escuela(text, boolean) to authenticated;
grant  execute on function public.guardar_departamento(text, text) to authenticated;
grant  execute on function public.exportar_escuelas() to authenticated;
grant  execute on function public.registrar_publicacion_escuelas(integer) to authenticated;
grant  execute on function public.estado_escuelas() to authenticated;

-- Que la API de Supabase vea enseguida las tablas y funciones nuevas
notify pgrst, 'reload schema';

-- Si llegó hasta acá, quedó instalado: tiene que mostrar 288 (o las escuelas
-- que haya en la nómina) y 0 sin orden
select count(*) filter (where origen = 'oficial' and vigente) as escuelas_de_la_nomina,
       count(*) filter (where origen = 'oficial' and vigente and orden is null) as sin_orden
  from public.escuelas;
