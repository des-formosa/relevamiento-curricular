-- ============================================================================
-- Unificar los contenidos escritos a mano (29/10/2026)
--
-- Se corre UNA VEZ en el SQL Editor, después de sql/17_textos_libres.sql. Se
-- puede repetir: la segunda vez no encuentra nada que cambiar.
--
-- Sale de revisar, saber por saber, los 2.952 textos distintos que habían
-- escrito los docentes hasta el 29/10 (3.249 respuestas). Dos listas:
--
-- 1. Equivalencias: en un mismo saber, formas que dicen lo mismo y solo
--    cambian en la escritura (tipeos, singular y plural, artículos, orden,
--    puntuación) o en la notación (N y «naturales», Z y «enteros», MCM y DCM
--    con MCM y MCD, la sigla y el nombre completo). Cada una pasa a decir la
--    forma más escrita. No se junta lo que cambia el alcance («operaciones
--    básicas» con «operaciones», «en N» con «en Z»), ni lo de dos saberes
--    distintos, ni lo escrito a mano con una sugerencia del catálogo.
-- 2. «No trabajo»: las respuestas que dicen que el saber no se trabaja. Salen
--    de los contenidos y el saber pasa a «no trabajo» en ese envío, salvo que
--    el docente haya elegido otros contenidos del mismo saber.
--
-- No se tocan los comentarios («lo trabajamos en segundo año», «todavía no»,
-- «se trabajará en el 3er trimestre»), ni las respuestas sin sentido, ni los
-- «no trabajo» de una parte del saber («no se trabaja have got…»).
--
-- Para deshacer una (todo queda anotado en textos_libres_cambios):
--   select public.separar_variante('matematica--e1--n3', 'mcm y mcd');
--   select public.restaurar_texto_no('no trabajo estos temas');
-- ============================================================================

do $$
begin
  if to_regclass('public.equivalencias_texto_libre') is null then
    raise exception 'Primero hay que correr sql/17_textos_libres.sql.';
  end if;
end $$;

-- (saber, cómo lo escribió alguien, cómo queda, por qué)
insert into public.equivalencias_texto_libre (saber_id, variante, texto, canonico, tipo)
select v.saber_id, v.variante, v.texto, public.normalizar_texto(v.texto), v.tipo
  from (values
  -- Lengua · 2° año · 1er trimestre · «Prácticas de conversación y discusión orales incorporando recursos avanzados:…»
  ('lengua--e1--pr-a2t1s1', 'reconocimiento y analisis de texto que ideas emociones y necesidades vinculadas con el cuidado del cuerpo y la salud esi', 'Reconocimiento y análisis de textos que expresen ideas y emociones y necesidades vinculadas con el cuidado del cuerpo y la salud (ESI)', 'escritura'),
  -- Lenguas Extranjeras · 3° año · 1er trimestre · «Selección de recursos lingüísticos para expresar habilidades.»
  ('lenguas-extranjeras--e4--n1', 'can y can t', 'Can/Can''t', 'escritura'),
  ('lenguas-extranjeras--e4--n1', 'verbo can y can t', 'Can/Can''t', 'escritura'),
  ('lenguas-extranjeras--e4--n1', 'verbo can can t', 'Can/Can''t', 'escritura'),
  ('lenguas-extranjeras--e4--n1', 'verb can', 'Verbo Can', 'escritura'),
  ('lenguas-extranjeras--e4--n1', 'verbo can forma afirmativa negativa e interrogativa', 'Verbo can en las formas afirmativas, negativas e interrogativas', 'escritura'),
  ('lenguas-extranjeras--e4--n1', 'verbos modales can can t', 'uso del verbo modal can/can t', 'escritura'),
  ('lenguas-extranjeras--e4--n1', 'present simple', 'Presente simple', 'escritura'),
  ('lenguas-extranjeras--e4--n1', 'presente simple y continuo', 'Presente simple y presente continuo', 'escritura'),
  ('lenguas-extranjeras--e4--n1', 'there is are', 'there is/there are', 'escritura'),
  -- Educación Artística - Artes Visuales · 1° año · 3er trimestre · «Valoración de los aportes de las nuevas tecnologías en el tratamiento de la di…»
  ('educacion-artistica-artes-visuales--e2--a1s10', 'lectura comprensiva de textos referidos a procedimientos tecnicos y compositivos de la musica apreciacion de lis elementos constitutivos de la musica', 'Lectura comprensiva de textos referidos a procedimientos técnicos y compositivos de la música. Apreciación de los elementos constitutivos de la música', 'escritura'),
  -- Educación Artística - Danza · 1° año · 1er trimestre · «El movimiento y su relación con el cuerpo, el espacio, el tiempo, la dinámica…»
  ('educacion-artistica-danza--e1--a1s1', 'el movimiento y ritmo musical', 'Movimiento y ritmo musical', 'escritura'),
  -- Matemática · 1° año · 1er trimestre · «Resolución de problemas que requieran del uso de las propiedades de la suma, r…»
  ('matematica--e1--pr-a1t1s1', 'operaciones combinadsen n', 'Operaciones combinadas en N', 'escritura'),
  -- Matemática · 1° año · 1er trimestre · «Expresión de cantidades y números seleccionando el tipo de cálculo (mental y e…»
  ('matematica--e1--n2', 'naturales', 'Numeros naturales', 'escritura'),
  ('matematica--e1--n2', 'fracciones y expresion decimal', 'Fracciones y expresiones decimales', 'escritura'),
  ('matematica--e1--n2', 'operaciones con numeros naturales', 'Operaciones en N', 'notacion'),
  ('matematica--e1--n2', 'descomposicion de numero', 'Descomposición de números', 'escritura'),
  ('matematica--e1--n2', 'estadistica calculo de frecuencia relativa y porcentual angulo central resolucion de situaciones en naturales', 'Estadística: cálculo de frecuencias relativa y porcentual. Ángulo central. Resolución de situaciones en naturales.', 'escritura'),
  ('matematica--e1--n2', 'operaciones propiedades', 'Propiedades y operaciones', 'escritura'),
  ('matematica--e1--n2', 'revolucion de problemas en situaciones reales', 'Resolución de problemas en situaciones reales', 'escritura'),
  -- Matemática · 1° año · 1er trimestre · «Análisis de las afirmaciones sobre las relaciones ligadas a la divisibilidad (…»
  ('matematica--e1--n3', 'critererios de divisibilidad', 'Criterios de divisibilidad', 'escritura'),
  ('matematica--e1--n3', 'criterio de divisibilidad', 'Criterios de divisibilidad', 'escritura'),
  ('matematica--e1--n3', 'criterios de disibilidad', 'Criterios de divisibilidad', 'escritura'),
  ('matematica--e1--n3', 'multiplo y dovisores', 'Multiplos y divisores', 'escritura'),
  ('matematica--e1--n3', 'multiplos y divisiores', 'Multiplos y divisores', 'escritura'),
  ('matematica--e1--n3', 'multiplos y divisore', 'Multiplos y divisores', 'escritura'),
  ('matematica--e1--n3', 'mcm dcm', 'MCM y DCM', 'escritura'),
  ('matematica--e1--n3', 'mcm y mcd', 'MCM y DCM', 'notacion'),
  ('matematica--e1--n3', 'mcd y mcm', 'MCM y DCM', 'notacion'),
  ('matematica--e1--n3', 'mcm mcd', 'MCM y DCM', 'notacion'),
  ('matematica--e1--n3', 'multiplo comun menor divisor comun mayor', 'MCM y DCM', 'notacion'),
  ('matematica--e1--n3', 'multiplo comun menor y divisor comun mayor', 'MCM y DCM', 'notacion'),
  ('matematica--e1--n3', 'maximo comun divisor y minimo comun multiplo', 'MCM y DCM', 'notacion'),
  ('matematica--e1--n3', 'minimo comun multiplo y maximo comun divisor', 'MCM y DCM', 'notacion'),
  ('matematica--e1--n3', 'propiedsdes de las operaciones', 'Propiedades de las operaciones', 'escritura'),
  ('matematica--e1--n3', 'criteros de divisibilidad numeros primos y compuestos', 'Criterios de divisibilidad, números primos y compuestos', 'escritura'),
  ('matematica--e1--n3', 'criterios de divisibilidad con multiplos y divisores', 'Multiplos y divisores, criterios de divisibilidad', 'escritura'),
  ('matematica--e1--n3', 'multiplos y divisores criterio de divisibilidad', 'Multiplos y divisores, criterios de divisibilidad', 'escritura'),
  ('matematica--e1--n3', 'divisibilidad numeros primos y compuestos multiplos y divisores mcm y mcd resolucion de problemas', 'Divisibilidad, múltiplos y divisores .MCM y MCD, números primos y compuestos. Resolución de problemas', 'escritura'),
  ('matematica--e1--n3', 'identificacion de multiplos y divisores comunes de un numeros natural', 'Identificación de múltiplos y divisores comunes de un número natural.', 'escritura'),
  ('matematica--e1--n3', 'identificacion del mcm mcd en situaciones planteadas', 'Identificación del mcm y mcd en situaciones planteadas', 'escritura'),
  ('matematica--e1--n3', 'mutiplos y divisores criterios de divisibilidad mcm y mcd', 'Múltiplos y divisores, criterios de divisibilidad, MCM y MCD', 'escritura'),
  ('matematica--e1--n3', 'multiplos y divisores critrios de divisibilidad mcm y decm', 'Múltiplos y divisores, criterios de divisibilidad, MCM y MCD', 'escritura'),
  ('matematica--e1--n3', 'multiplos y divisores m c m y d c m', 'Múltiplos y divisores, mcm, MCD.', 'escritura'),
  ('matematica--e1--n3', 'multiplos divisores m c m d c m', 'Múltiplos y divisores, mcm, MCD.', 'escritura'),
  ('matematica--e1--n3', 'operaciones con divisiones fracciones', 'Operaciones con divisiones y fracciones', 'escritura'),
  ('matematica--e1--n3', 'propiedades de la suma y multiplicacion', 'propiedades de la suma y la multiplicación', 'escritura'),
  ('matematica--e1--n3', 'descomposicion de numeros en factores prim', 'Descomposición de un numero en factores primos.', 'escritura'),
  ('matematica--e1--n3', 'descomposicion en factores primos', 'Descomposición de un numero en factores primos.', 'escritura'),
  ('matematica--e1--n3', 'multiplos y divisores de numeros naturales', 'Múltiplos y divisores de un número natural', 'escritura'),
  -- Matemática · 1° año · 1er trimestre · «Cálculo de potencias cuadradas, cubicas y raíces cuadradas de números naturale…»
  ('matematica--e1--n4', 'potenciacion y radicacion con numeros naturales', 'Potenciación y radicación de números naturales', 'escritura'),
  ('matematica--e1--n4', 'potencia y radicacion de numeros naturales', 'Potenciación y radicación de números naturales', 'escritura'),
  ('matematica--e1--n4', 'potenciacion y radicacion en n', 'Potenciación y radicación de números naturales', 'notacion'),
  ('matematica--e1--n4', 'potenciacion y radicacion en elconjunto n', 'Potenciación y radicación de números naturales', 'notacion'),
  ('matematica--e1--n4', 'pontenciacion y radicacion', 'Potenciacion y radicacion', 'escritura'),
  ('matematica--e1--n4', 'potenciaciin y radicacion', 'Potenciacion y radicacion', 'escritura'),
  ('matematica--e1--n4', 'potenciacion radicacion', 'Potenciacion y radicacion', 'escritura'),
  ('matematica--e1--n4', 'potencia y radicacion', 'Potenciacion y radicacion', 'escritura'),
  ('matematica--e1--n4', 'potencias radicacion', 'Potenciacion y radicacion', 'escritura'),
  ('matematica--e1--n4', 'potenciacion propiedades', 'propiedades de la potenciacion', 'escritura'),
  ('matematica--e1--n4', 'propiedades de la potencia', 'propiedades de la potenciacion', 'escritura'),
  ('matematica--e1--n4', 'potencia raices', 'Potencias y raices', 'escritura'),
  ('matematica--e1--n4', 'calculo de potencia cuadradas cubicas y raices cuadradas de numeros naturales', 'Cálculo de potencias cuadradas, cúbicas y raíces cuadradas de números naturales', 'escritura'),
  ('matematica--e1--n4', 'canculo de potencias cuadradas cubicas y raices cuadradas de numeros naturales', 'Cálculo de potencias cuadradas, cúbicas y raíces cuadradas de números naturales', 'escritura'),
  ('matematica--e1--n4', 'operaciones con naturales', 'Operaciones con numeros Naturales', 'escritura'),
  ('matematica--e1--n4', 'potecias cuadradas y cubicas raices cuadradas y cubicas', 'Potencias Cuadradas y cúbicas. Raíces Cuadradas y cúbicas.', 'escritura'),
  ('matematica--e1--n4', 'potencia cuadratica y cubica', 'Potencias cuadradas y cúbicas', 'escritura'),
  ('matematica--e1--n4', 'potenciacion cuadraticas y cubicas', 'Potencias cuadradas y cúbicas', 'escritura'),
  ('matematica--e1--n4', 'potenciocion cuadradra y cubica', 'Potencias cuadradas y cúbicas', 'escritura'),
  ('matematica--e1--n4', 'potencia cuadrada potencia cubica', 'Potencias cuadradas y cúbicas', 'escritura'),
  ('matematica--e1--n4', 'potencia y radicacion propiedades', 'Potenciación y radicación: propiedades', 'escritura'),
  ('matematica--e1--n4', 'potenciacion y sus propiedades radicacion', 'Potenciación y radicación: propiedades', 'escritura'),
  ('matematica--e1--n4', 'propiedades de potenciacion y radicacion', 'Potenciación y radicación: propiedades', 'escritura'),
  ('matematica--e1--n4', 'potencias raices cuadradas de numeros naturales', 'potencias y raices cuadradas de numeros naturales', 'escritura'),
  ('matematica--e1--n4', 'potencias raices cuadradas cubicas', 'Potencias, raíces cuadradas y cúbicas', 'escritura'),
  ('matematica--e1--n4', 'potencias raices cuadrada y cubica', 'Potencias, raíces cuadradas y cúbicas', 'escritura'),
  ('matematica--e1--n4', 'potencia raiz cuadrada y cubica', 'Potencias, raíces cuadradas y cúbicas', 'escritura'),
  ('matematica--e1--n4', 'raiz cuadrada raiz cubica', 'Raíz cuadrada y cúbica.', 'escritura'),
  ('matematica--e1--n4', 'potencia y radicacion operaciones combinadas', 'Potenciacion. Radicacion. operaciones combinadas.', 'escritura'),
  -- Matemática · 1° año · 2do trimestre · «Resolución de ecuaciones lineales con una incógnita»
  ('matematica--e2--pr-a1t2s4', 'ecuaciines de primer grado con una incognita en n', 'Ecuaciones de primer grado con una incógnita en N', 'escritura'),
  ('matematica--e2--pr-a1t2s4', 'ecuacion de primer grado con una imcognita en n', 'Ecuaciones de primer grado con una incógnita en N', 'escritura'),
  ('matematica--e2--pr-a1t2s4', 'ecuaciones de priner grado con una incognita en n', 'Ecuaciones de primer grado con una incógnita en N', 'escritura'),
  ('matematica--e2--pr-a1t2s4', 'ecuaciones de prwimer grado con una incognita en n', 'Ecuaciones de primer grado con una incógnita en N', 'escritura'),
  ('matematica--e2--pr-a1t2s4', 'ecusciones de primer grado von uns incognita en n', 'Ecuaciones de primer grado con una incógnita en N', 'escritura'),
  ('matematica--e2--pr-a1t2s4', 'ecuaciones de primer grado con una incognita en naturales', 'Ecuaciones de primer grado con una incógnita en N', 'notacion'),
  ('matematica--e2--pr-a1t2s4', 'ecuaciones lineales de primer grado con una incognita en n', 'Ecuaciones de primer grado con una incógnita en N', 'notacion'),
  ('matematica--e2--pr-a1t2s4', 'ecuacion de primer grado con n', 'Ecuaciones de primer grado con N', 'escritura'),
  ('matematica--e2--pr-a1t2s4', 'ecuaciones de 1er grado con baturales', 'Ecuaciones de primer grado con N', 'notacion'),
  ('matematica--e2--pr-a1t2s4', 'ecuaciones en in', 'Ecuaciones en N', 'escritura'),
  ('matematica--e2--pr-a1t2s4', 'ecuaciones en n hallando perimetro y area de figuras geometricas', 'Ecuaciones en N para hallar perímetro y área de figuras geométricas', 'escritura'),
  -- Matemática · 1° año · 2do trimestre · «Resolución de problemas que requieran la realización de operaciones en el conj…»
  ('matematica--e1--pr-a1t2s1', 'operaciones combinadas de numeros naturales', 'Operaciones combinadas con números naturales', 'escritura'),
  ('matematica--e1--pr-a1t2s1', 'operaciones combinadas en el conjunto de los numeros naturales', 'Operaciones combinadas con números naturales', 'escritura'),
  -- Matemática · 1° año · 3er trimestre · «Identificación del tipo de gráfico estadístico que presenta la información»
  ('matematica--e4--pr-a1t3s2', 'grafico de barras', 'Gráficos de barras', 'escritura'),
  ('matematica--e4--pr-a1t3s2', 'graficos de barra', 'Gráficos de barras', 'escritura'),
  -- Matemática · 1° año · 3er trimestre · «Resolución de situaciones que den significado a la suma, resta, multiplicación…»
  ('matematica--e1--pr-a1t3s2', 'operacione en n', 'Operaciones en N', 'escritura'),
  ('matematica--e1--pr-a1t3s2', 'operaciones con n', 'Operaciones en N', 'escritura'),
  ('matematica--e1--pr-a1t3s2', 'operaciones con numeros naturales', 'Operaciones en N', 'notacion'),
  ('matematica--e1--pr-a1t3s2', 'operaciones en naturales', 'Operaciones en N', 'notacion'),
  -- Matemática · 2° año · 1er trimestre · «Interpretación del significado de la media y el modo para describir los datos…»
  ('matematica--e4--pr-a2t1s2', 'medianas', 'Mediana', 'escritura'),
  ('matematica--e4--pr-a2t1s2', 'parametros medida de tendencia central mediana', 'Parametro/medida de tendencia central: mediana', 'escritura'),
  -- Matemática · 2° año · 1er trimestre · «Resolución de situaciones que den significado a la suma, resta, multiplicación…»
  ('matematica--e1--n5', 'operaciones combinadaa', 'Operaciones combinadas', 'escritura'),
  ('matematica--e1--n5', 'operaciones combinads', 'Operaciones combinadas', 'escritura'),
  ('matematica--e1--n5', 'operacipnes combinadas', 'Operaciones combinadas', 'escritura'),
  ('matematica--e1--n5', 'operacines combinadas', 'Operaciones combinadas', 'escritura'),
  ('matematica--e1--n5', 'operaciones en z', 'Operaciones con números enteros', 'notacion'),
  ('matematica--e1--n5', 'operaviones en z', 'Operaciones con números enteros', 'notacion'),
  ('matematica--e1--n5', 'rsolucion de problemas', 'Resolucion de problemas', 'escritura'),
  ('matematica--e1--n5', 'situaciones probrematicas', 'Situaciones problematicas', 'escritura'),
  ('matematica--e1--n5', 'situaciones problemas', 'Situaciones problematicas', 'escritura'),
  ('matematica--e1--n5', 'situacion problema', 'Situaciones problematicas', 'escritura'),
  ('matematica--e1--n5', 'operacones basicas en z', 'Operaciones básicas en Z', 'escritura'),
  ('matematica--e1--n5', 'operaciones basicas con numeros enteros', 'Operaciones básicas en Z', 'notacion'),
  ('matematica--e1--n5', 'operaciones combinadas con numeros enteros', 'Operaciones combinadas en Z', 'notacion'),
  ('matematica--e1--n5', 'operaciones combinadas en enteros', 'Operaciones combinadas en Z', 'notacion'),
  ('matematica--e1--n5', 'numero enteros', 'Numeros enteros', 'escritura'),
  ('matematica--e1--n5', 'conjunto z', 'Numeros enteros', 'notacion'),
  ('matematica--e1--n5', 'propiedades de la operaciones', 'Propiedades de las operaciones', 'escritura'),
  ('matematica--e1--n5', 'conjunto de numeros enteros resoluciones de situaciones problematicas', 'RESOLUCION DE SITUACIONES PROBLEMATICAS CON NUMEROS ENTEROS', 'escritura'),
  ('matematica--e1--n5', 'numeros enteros operaciones y propiedades', 'OPERACIONES CON NUMEROS ENTEROS. PROPIEDADES', 'escritura'),
  ('matematica--e1--n5', 'regla de signos', 'Regla de los signos', 'escritura'),
  ('matematica--e1--n5', 'rwgla de los signos procedimientos para resolver las operaciones', 'Regla de signos , procedimiento para resolver las operaciones en Z', 'escritura'),
  ('matematica--e1--n5', 'situaciones problematica con operaciones basicas', 'Situaciones problemáticas con operaciones básicas', 'escritura'),
  ('matematica--e1--n5', 'situaciones problematicas con operaciones basiicas', 'Situaciones problemáticas con operaciones básicas', 'escritura'),
  ('matematica--e1--n5', 'situaciones problematicas con en z', 'Situaciones problematicas en Z', 'escritura'),
  ('matematica--e1--n5', 'operaciones en z suma resta multiplicacion division potenciacion y radicacion en z', 'Operaciones en Z. Suma, resta, multiplicación, división, potenciación y radicación', 'escritura'),
  ('matematica--e1--n5', 'suma algebraica situaciones problematicas potencias de numeros enteros propiedades de la potenciacion propiedad de la potenciacion', 'Suma algebraica. Situaciones problemáticas. Potencia de Números enteros. Propiedades de la potenciación.', 'escritura'),
  ('matematica--e1--n5', 'oeraciones', 'Operaciones', 'escritura'),
  -- Matemática · 2° año · 2do trimestre · «Resolución de problemas de varios pasos, sobre los diferentes sentidos de las…»
  ('matematica--e1--pr-a2t2s1', 'oper aciones y propiedades en z', 'Operaciones y propiedades en Z', 'escritura'),
  ('matematica--e1--pr-a2t2s1', 'calculo de petimetro y area de figuras geometricas', 'Cálculo de perimetro y área de figuras geométricas', 'escritura'),
  -- Matemática · 3° año · 1er trimestre · «Representaciones de un numero racional (expresiones fraccionarias y decimales,…»
  ('matematica--e1--n6', 'represebtacion en la recta numerica', 'Representacion en la recta numerica', 'escritura'),
  ('matematica--e1--n6', 'representacion en recta numerica', 'Representacion en la recta numerica', 'escritura'),
  ('matematica--e1--n6', 'numeros racionales operaciones', 'Operaciones en Q', 'notacion'),
  ('matematica--e1--n6', 'expresiones decimales y fraccionarias', 'Expresiones fraccionarias y decimales', 'escritura'),
  ('matematica--e1--n6', 'expresiones fraccionarias y desimales', 'Expresiones fraccionarias y decimales', 'escritura'),
  ('matematica--e1--n6', 'notacion cietifica', 'notacion cientifica', 'escritura'),
  ('matematica--e1--n6', 'equivalencias de fracciones numeros decimales', 'Equivalencia entre fracciones y números decimales', 'escritura'),
  ('matematica--e1--n6', 'expresion decimal periodica', 'expresiones decimales periódicas', 'escritura'),
  ('matematica--e1--n6', 'expresiones decimales y fraccionarias punto en la recta numerica', 'Expresiones decimales y fraccionarias, punto de la recta numérica', 'escritura'),
  ('matematica--e1--n6', 'operaciones basica', 'Operaciones básicas', 'escritura'),
  ('matematica--e1--n6', 'pasaje de fracciones a decimales y viceversa', 'Pasaje de fracción a decimal y viceversa', 'escritura'),
  ('matematica--e1--n6', 'pasaje de fraccion a decimal y de decimal a fracciones', 'Pasaje de fracción a decimal y viceversa', 'escritura'),
  ('matematica--e1--n6', 'representacion de numeros racionales en la recya numerica', 'Representacion en la recta numerica de un numero racional', 'escritura'),
  ('matematica--e1--n6', 'representacion enla recta numerca de racionales en q', 'Representacion en la recta numerica de un numero racional', 'escritura'),
  ('matematica--e1--n6', 'representacion de numeros q en la recta numerica', 'Representacion en la recta numerica de un numero racional', 'notacion'),
  ('matematica--e1--n6', 'representacion de un numero racional', 'Representaciones de un número racional.', 'escritura'),
  ('matematica--e1--n6', 'representaciones de numeros racionales', 'Representaciones de un número racional.', 'escritura'),
  ('matematica--e1--n6', 'oeraciones', 'Operaciones', 'escritura'),
  ('matematica--e1--n6', 'operacines combinadas', 'Operaciones combinadas', 'escritura'),
  -- Matemática · 3° año · 3er trimestre · «Elaboración de gráficos estadísticos (histogramas, polígonos de frecuencia, gr…»
  ('matematica--e4--pr-a3t3s2', 'tabla de frecuencia para fatos simples', 'Tabla de frecuencias para datos simples', 'escritura'),
  -- Matemática · 3° año · 3er trimestre · «Reconocimiento y uso de la probabilidad como un modo de cuantificar la incerti…»
  ('matematica--e4--pr-a3t3s5', 'calculo combinatio tecnica de conteo diagrama de arbol', 'Cálculo combinatorio: técnica de conteo. Diagrama de árbol', 'escritura'),
  -- Biología · 2° año · 3er trimestre · «Seminario o laboratorio de Biología: análisis de situaciones de riesgo o de vi…»
  ('biologia--e1--a2s9', 'vinculos saludables esi', 'Vinculos saludables.', 'escritura'),
  -- Biología · 3° año · 1er trimestre · «Caracterización de la función de reproducción en los seres vivos y reconocimie…»
  ('biologia--e1--a3s1', 'la diversidad y diferenciacion celular', 'Diversidad y diferenciación celular', 'escritura'),
  -- Físico-Química · 1° año · 1er trimestre · «Seminario/Laboratorio de Físico-Química: utilización del modelo cinético corpu…»
  ('fisico-quimica--e1--a1s1', 'el metodo cientifico', 'Método científico', 'escritura'),
  -- Físico-Química · 2° año · 1er trimestre · «Abordaje de los estados de agregación, sus cambios y el proceso de disolución,…»
  ('fisico-quimica--e1--a2s1', 'acidos y bases ph', 'Ácidos, bases y pH', 'escritura'),
  -- Educación Tecnológica · 1° año · 1er trimestre · «Resolución de problemas o técnicas de control de calidad de productos y proces…»
  ('educacion-tecnologica--e1--a1s10', 'procesos productivos sistema de produccion', 'Procesos Productivos: Sistemas de Producción.', 'escritura'),
  -- Historia · 1° año · 1er trimestre · «Comprension del caracter cientifico de la Historia. El uso de diferentes fuent…»
  ('historia--e1--n1', 'ciencias auxilires de la historia', 'Las ciencias auxiliares de la historia.', 'escritura'),
  -- Historia · 2° año · 1er trimestre · «Mundo grecorromano: Grecia y Roma como sociedades históricas.»
  ('historia--e1--n2', 'efemeride malvinas', 'Efemérides Malvinas', 'escritura'),
  ('historia--e1--n2', 'ls civilizaciones precolombinas', 'Civilizaciones precolombinas.', 'escritura'),
  ('historia--e1--n2', 'reconocimiento y valoracion de la incorporacion del actual territorio de fsa a la vida politica y econ del pais', 'Reconocimiento y valoración de la incorporación del actual territorio de Formosa a la vida política y económica del país.', 'escritura'),
  -- Historia · 2° año · 2do trimestre · «Fragmentación del mundo romano y conformación de sociedades feudales.»
  ('historia--e1--n3', 'expansion ultramarina europea descubrimeinto conquista y colonizacion de america', 'Expansión Ultramarina Europea . Descubrimiento, Conquista y Colonización de America', 'escritura'),
  ('historia--e1--n3', 'expansion ultramarina y rpoceso de conquista y colonizcion en america', 'Expansion ultramarina y proceso de conquista y colonizacion en América', 'escritura'),
  -- Historia · 2° año · 3er trimestre · «Crisis del feudalismo, expansión europea y contacto/conquista de América.»
  ('historia--e1--a2s3', 'aproximacion a los cambios que produce la revolucion industrial', 'Aproximacion a los cambios que introduce la revolucion industrial.', 'escritura'),
  ('historia--e1--a2s3', 'poceso fundacional de formosa provincializacion', 'Proceso fundacional de Formosa. Provincialización.', 'escritura'),
  ('historia--e1--a2s3', 'proceso fundacional de gormosa provincializacion', 'Proceso fundacional de Formosa. Provincialización.', 'escritura'),
  ('historia--e1--a2s3', 'esi eje el cuidado del cuerpo y la salud', 'ESI:El cuidado del cuerpo y la salud', 'escritura'),
  ('historia--e1--a2s3', 'expansion ultramrina', 'Expansion ultramarina europea', 'escritura'),
  -- Historia · 3° año · 1er trimestre · «La expansión europea y la construcción de los imperios coloniales.»
  ('historia--e1--a3s1', 'esi reconocer habitos de cuidado del cuerpo y promocion de la salud en particular el cuidado de consumo de sustancias problematicas', 'ESI:Reconocer habitos del cuidado del cuerpo y promocion de la salud en particular con el consumó de sustancias problemáticas', 'escritura'),
  ('historia--e1--a3s1', 'conocimiento de la crisis politico conservador oligarquico y la ampliacion de la ciudadania en la arg', 'Conocimiento de la crisis del sistema político conservador/oligárquico y de la ampliación de la ciudadanía en la Argentina', 'escritura'),
  -- Historia · 3° año · 2do trimestre · «Las transformaciones de las monarquías europeas en el siglo XVIII.»
  ('historia--e1--a3s5', 'unitaris vs federales', 'Unitarios y Federales', 'escritura'),
  ('historia--e1--a3s5', 'reconocimiento desde multiples interpretaciones de los cambios y continuidades entre los gobiernos radicales 1916 1930 y los gobiernos conservadores', 'Reconocimiento -desde múltiples interpretaciones-de los cambios y continuidades entre los gobiernos radicales (1916-1930) y los gobiernos conservadores/oligárquicos', 'escritura'),
  ('historia--e1--a3s5', 'reconocimiento desde multiples interpretaciones de cambios y continuidades entre los gobiernos radicales y gobiernos conservadores', 'Reconocimiento -desde múltiples interpretaciones-de los cambios y continuidades entre los gobiernos radicales (1916-1930) y los gobiernos conservadores/oligárquicos', 'escritura'),
  ('historia--e1--a3s5', 'el proceso revolucionario argentino las economias regionales del rio de la plata', 'Proceso revolucionario argentino. Las economias regionales de las Provincias Unidas del Río de la Plata', 'escritura'),
  -- Historia · 3° año · 3er trimestre · «Revolución de Mayo y proceso independentista en América y el Río de la Plata.»
  ('historia--e1--a3s7', 'inestabilidad politica proscripcion y golpe de estado', 'Inestabilidad politica .Proscripcion y golpes de estado.', 'escritura'),
  ('historia--e1--a3s7', 'reforma electi', 'Reforma electoral 1912', 'escritura'),
  ('historia--e1--a3s7', 'conocimiento de la crisis del sistema politico conservaor oligarquico y de la ampliacion de la ciudadania en la argentina', 'Conocimiento de la crisis del sistema político conservador oligárquico y de la ampliación de la ciudadanía en la Argentina', 'escritura'),
  ('historia--e1--a3s7', 'conocimiento de la crisis del sistema politico conservador y la ampliacion de la ciudadania en la argentina', 'Conocimiento de la crisis del sistema político conservador oligárquico y de la ampliación de la ciudadanía en la Argentina', 'escritura'),
  -- Geografía · 1° año · 1er trimestre · «Distintos espacios, diferentes realidades socio históricas y representaciones…»
  ('geografia--e1--a1s4', 'el plano de la ciudad de formosa', 'Plano de la Ciudad de Formosa .', 'escritura'),
  -- Geografía · 3° año · 2do trimestre · «Aprovechamientos, planificación territorial y del uso del suelo. Ambientes pro…»
  ('geografia--e1--a3s8', 'circuito productivo', 'Circuitos productivos', 'escritura'),
  -- Formación Ética y Compromiso Comunitario · 2° año · 1er trimestre · «En relación con la reflexión ética.»
  ('formacion-etica-y-compromiso-comunitario--e1--a2s1', 'necesidades basicas y estrategias de supervivencias', 'Necesidades básicas y estrategias de supervivencia', 'escritura'),
  ('formacion-etica-y-compromiso-comunitario--e1--a2s1', 'normas de convivencias y la importancia de establecer acuerdos', 'Normas de convivencia y la importancia de establecer acuerdos.', 'escritura'),
  -- Formación Ética y Compromiso Comunitario · 2° año · 2do trimestre · «Reconocimiento y reflexión sobre situaciones de violencia en las relaciones in…»
  ('formacion-etica-y-compromiso-comunitario--e2--a2s8', 'comprension de la ciudadania como construccion colectiva y practica', 'Comprensión de la ciudadania como construcción colectiva y práctica social', 'escritura'),
  -- Educación Física · 1° año · 1er trimestre · «Comprensión de acciones motrices que rigen al juego y a los deportes.»
  ('educacion-fisica--e1--a1s10', 'iniciacion deportiva voley y futbol simplificado juegos modificados 3 vs 3 arbitraje pedagoggico por parte de los alumnos construccion colectiva de reglas adaptado al material y espacio', 'Iniciación deportiva futbol y vóley simplificado juegos modificados 3vs 3 arbitraje pedagógico por parte de los alumnos , construcción colectiva de reglas, adaptado a material y espacio', 'escritura')
  ) as v(saber_id, variante, texto, tipo)
 where exists (select 1 from public.saberes s where s.id = v.saber_id)
on conflict (saber_id, variante) do nothing;

insert into public.textos_no_trabajo (texto_normalizado)
values
  ('no'),
  ('ninguno'),
  ('no trabajo'),
  ('no lo trabajo'),
  ('no trabajo este saber'),
  ('no trabajo estos saberes'),
  ('no trababajo estos saberes'),
  ('no trabajo estos aberes'),
  ('no trabajo estos temas'),
  ('no trabajo estos temas en este trimestre'),
  ('no trabaje'),
  ('no trabaje estos saberes'),
  ('no trabaje esto temas'),
  ('no lo trabajamos'),
  ('no trabajamos'),
  ('no se trabajo'),
  ('no desarrolle'),
  ('no se pudo desarrollar'),
  ('no se alcanzo a desarrollar'),
  ('no alcance a trabajar estos saberes'),
  ('no llegamos a desarrollar estas actividades por razones de tiempo'),
  ('no se se desarrollo por la inclemencias del tiempo'),
  ('no se desarrolla estos contenidos en el ciclo basico'),
  ('no se trabajan estos temas en l e frances'),
  ('no se trabajo con ninguno de las aplicaciones mencionadas'),
  ('no trabajo texto argumentativo'),
  ('no trabajo texto expositivo en 1 ano'),
  ('en el segundo trimestre no se desarrollo la oralidad'),
  ('de la lista ninguno todos los trabajomos en 2 ano'),
  ('no llegue a este contenido porque con los alumnos de eib tienen su tiempo'),
  ('no puedo trabajar este tipo de actividad porque no cuento con el espacio ni los materiales nacesarios oara ooevar a cabo'),
  ('no se alcanza a dar funciones en 2do ano se priorizo estadistica numeros enteros triangulos dimos prioridad a ecuaciones ya que para preparar a los alumnos en olimpiadas fue un saber que por falta de tiempo no se alcanzaba a desarrollar'),
  ('no trabajamos la revolucion de mayo se hace hincapie en las revolucion liberales y su impacto en america para asi trabajar el ano siguiente sobre las tematicas planteadas')
on conflict do nothing;

-- Se aplica a todo lo cargado. De acá en más, el trigger lo aplica solo a
-- cada envío y reenvío.
select public.aplicar_textos_libres() as resultado;
