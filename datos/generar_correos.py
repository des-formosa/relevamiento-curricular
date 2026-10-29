"""
Correos oficiales de las escuelas y de las delegaciones zonales → SQL que los
carga en contactos_escuela, al lado de los contactos de los directivos.

El Ministerio los manda en un Word («CORREOS OF. NUMERADOS CAPITAL-INTERIOR-DZ»),
un párrafo por escuela: «EPES N° 10 Correo Oficial <mcye.epes10@formosa.gov.ar>»,
y al final las delegaciones: «DELEGACIÓN PIRANÉ mcye.delgacionpirane@formosa.gov.ar».
No son datos personales, pero igual que los de los directivos no se versionan
(ni el Word ni el SQL, ver .gitignore): el repositorio es público.

Cada E.P.E.S. recibe dos contactos con origen 'correos_oficiales':
  - «Correo oficial», con el de la escuela;
  - «Delegación zonal …», con el de la delegación que figura en la nómina.
Los anexos no reciben nada: la ficha muestra los de su sede.

Uso:
    python datos/generar_correos.py CORREOS.docx
    python datos/generar_correos.py CORREOS.docx --revisar      informa sin escribir
    python datos/generar_correos.py CORREOS.docx --salida ruta.sql

Por defecto escribe sql/privado/15_cargar_correos.sql.
"""
import argparse
import json
import re
import sys
import unicodedata
import zipfile
from pathlib import Path

import openpyxl

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / 'sql' / 'privado' / '15_cargar_correos.sql'
NOMINA = RAIZ / 'datos' / 'Nomina de Escuelas por Departamentos.xlsx'
CORREO = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')


def normalizar(t):
    t = unicodedata.normalize('NFD', str(t or '').lower())
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', t)).strip()


def clave_delegacion(t):
    """«DELEGACIÓN DEL RIO MUERTO» y «RIO MUERTO» → «riomuerto»; «GRAL GUEMES» → «guemes»."""
    t = normalizar(t)
    t = re.sub(r'\b(delegacion|delgacion|del|gral|general)\b', ' ', t)
    return t.replace(' ', '')


def parrafos(ruta):
    """El texto de cada párrafo del Word, sin depender de python-docx."""
    with zipfile.ZipFile(ruta) as z:
        xml = z.read('word/document.xml').decode('utf-8')
    for p in re.findall(r'<w:p[ >].*?</w:p>', xml, flags=re.S):
        texto = ''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', p))
        if texto.strip():
            yield texto.strip()


def id_escuela(texto):
    """«EPES N° 10», «EIB N° 1», «EPES EIB N° 2», «AGRARIA N° 1» → su id en la nómina."""
    t = normalizar(texto)
    m = re.match(r'^(epes eib|eib|epes agraria|agraria|epes) n ?(\d+)', t)
    if not m:
        return None
    tipo, num = m.group(1), m.group(2)
    if 'eib' in tipo:
        return f'epes-eib-{num}'
    if 'agraria' in tipo:
        return f'epes-agraria-{num}'
    return f'epes-{num}'


def titulo(t):
    chicas = {'de', 'del', 'la', 'el', 'los', 'las'}
    palabras = t.lower().split()
    return ' '.join(p if i and p in chicas else p[:1].upper() + p[1:] for i, p in enumerate(palabras))


def sql_texto(v):
    return 'null' if v in (None, '') else "'" + str(v).replace("'", "''") + "'"


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('word')
    p.add_argument('--revisar', action='store_true')
    p.add_argument('--salida', default=str(SALIDA))
    a = p.parse_args()

    escuelas = {e['id']: e for e in json.loads((RAIZ / 'datos' / 'escuelas.json').read_text(encoding='utf-8'))['escuelas']}
    # La delegación zonal de cada escuela sale de la nómina (columna B), por su orden
    hoja = openpyxl.load_workbook(NOMINA, read_only=True)['Hoja1']
    delegacion_por_orden = {int(f[0]): f[1] for f in hoja.iter_rows(min_row=2, values_only=True) if f[0]}

    correos, delegaciones, sin_escuela = {}, {}, []
    en_delegaciones = False
    for texto in parrafos(a.word):
        if 'DELEGACIONES ZONALES' in texto.upper():
            en_delegaciones = True
            continue
        correo = CORREO.search(texto)
        if not correo:
            continue
        if en_delegaciones:
            nombre = re.sub(r'(?i)^delegaci[oó]n\s+(del\s+)?', '', texto[:correo.start()]).strip()
            nombre = titulo(nombre).replace('Villa213', 'Villa 213').replace('Rio Muerto', 'Río Muerto')
            delegaciones[clave_delegacion(texto[:correo.start()])] = (nombre, correo.group(0).lower())
            continue
        escuela_id = id_escuela(texto)
        if escuela_id in escuelas:
            correos[escuela_id] = correo.group(0).lower()
        else:
            sin_escuela.append(texto)

    filas = []
    sin_delegacion = []
    for e in sorted(escuelas.values(), key=lambda x: x['orden']):
        es_anexo = e['tipo'].startswith('ANEXO') or re.search(r'(?i)\banexo\b', e['nombre'])
        if es_anexo:
            continue
        if e['id'] in correos:
            filas.append((e['id'], 'Correo oficial', correos[e['id']]))
        dz = delegaciones.get(clave_delegacion(delegacion_por_orden.get(e['orden'], '')))
        if dz:
            filas.append((e['id'], f'Delegación zonal {dz[0]}', dz[1]))
        else:
            sin_delegacion.append(f"{e['nombre']} (delegación «{delegacion_por_orden.get(e['orden'])}»)")

    sedes = [e for e in escuelas.values() if not (e['tipo'].startswith('ANEXO') or re.search(r'(?i)\banexo\b', e['nombre']))]
    sin_correo = [e['nombre'] for e in sorted(sedes, key=lambda x: x['orden']) if e['id'] not in correos]
    print(f"{len(correos)} correos oficiales de escuela, de {len(sedes)} E.P.E.S. de la nómina.")
    print(f"{len(delegaciones)} delegaciones zonales en el documento.")
    print(f"{len(filas)} contactos en total.")
    if sin_correo:
        print(f"{len(sin_correo)} E.P.E.S. sin correo en el documento: " + ', '.join(sin_correo))
    if sin_escuela:
        print(f"{len(sin_escuela)} correos del documento que no están en la nómina:")
        for s in sin_escuela:
            print('  - ' + s)
    if sin_delegacion:
        print(f"{len(sin_delegacion)} E.P.E.S. sin correo de su delegación: " + ', '.join(sin_delegacion))
    if a.revisar:
        return

    valores = ',\n'.join(f"  ({sql_texto(i)}, {sql_texto(n)}, {sql_texto(c)})" for i, n, c in filas)
    sql = f"""-- GENERADO por datos/generar_correos.py — NO VERSIONAR.
-- Carga los correos oficiales de las escuelas y de su delegación zonal como
-- contactos (origen 'correos_oficiales'). Se puede volver a correr: reemplaza
-- lo que vino de acá, y no agrega un correo que la escuela ya tenga (por
-- ejemplo, si el equipo lo corrigió o lo cargó a mano desde el panel).
begin;
alter table public.contactos_escuela drop constraint if exists contactos_escuela_origen_check;
alter table public.contactos_escuela add constraint contactos_escuela_origen_check
  check (origen in ('planilla_directivos', 'panel', 'correos_oficiales'));
delete from public.contactos_escuela where origen = 'correos_oficiales';
insert into public.contactos_escuela (escuela_id, nombre, correo, origen)
select v.escuela_id, v.nombre, v.correo, 'correos_oficiales'
  from (values
{valores}
  ) as v (escuela_id, nombre, correo)
  join public.escuelas e on e.id = v.escuela_id
 where not exists (select 1 from public.contactos_escuela p
                    where p.escuela_id = v.escuela_id and lower(p.correo) = v.correo);
commit;
select count(*) as correos_cargados from public.contactos_escuela where origen = 'correos_oficiales';
"""
    salida = Path(a.salida)
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text(sql, encoding='utf-8')
    print(f"Escrito {salida}")


if __name__ == '__main__':
    sys.exit(main())
