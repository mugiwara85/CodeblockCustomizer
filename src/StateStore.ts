import { ChangeSet } from "@codemirror/state";

type PermanentData<V> = Record<string, Record<string, V>>;

export class StateStore<K extends string | number, V> {
  isPermanent: boolean;
  permanentData: PermanentData<V> = {};
  private keyParser: (raw: string) => K;

  private session: Map<string, Map<K, V>> = new Map();

  constructor(isPermanent: boolean, keyParser: (raw: string) => K) {
    this.isPermanent = isPermanent;
    this.keyParser = keyParser;
  }

  // get single value
  get(filePath: string, key: K): V | undefined {
    if (this.isPermanent) {
      const record = this.permanentData[filePath];
      return record ? record[String(key)] : undefined;
    }
    return this.session.get(filePath)?.get(key);
  }// get

  // return all entries for a file as a Map. For permanent data, the record is converted to a Map
  getAll(filePath: string): Map<K, V> | undefined {
    if (this.isPermanent) {
      const record = this.permanentData[filePath];
      if (!record) {
        return undefined;
      }
      return new Map(Object.entries(record).map(([k, v]) => [this.keyParser(k), v]));
    }
    return this.session.get(filePath);
  }// getAll

  // set single value
  set(filePath: string, key: K, value: V): void {
    if (this.isPermanent) {
      if (!this.permanentData[filePath]) {
        this.permanentData[filePath] = {};
      }
      this.permanentData[filePath][String(key)] = value;
    } else {
      let map = this.session.get(filePath);
      if (!map) {
        map = new Map();
        this.session.set(filePath, map);
      }
      map.set(key, value);
    }
  }// set

  // delete a single entry. cleans up empty file records as well
  delete(filePath: string, key: K): void {
    if (this.isPermanent) {
      const record = this.permanentData[filePath];
      if (record) {
        delete record[String(key)];
        if (Object.keys(record).length === 0) {
          delete this.permanentData[filePath];
        }
      }
    } else {
      const map = this.session.get(filePath);
      if (map) {
        map.delete(key);
        if (map.size === 0) {
          this.session.delete(filePath);
        }
      }
    }
  }// delete

  // wipe both session and permanent stores
  clear(): void {
    this.session.clear();
    this.permanentData = {};
  }// clear

  remap(filePath: string, changes: ChangeSet): boolean {
    let changed = false;
    if (this.isPermanent) {
      const record = this.permanentData[filePath];
      if (!record) {
        return false;
      }

      const newRecord: Record<string, V> = {};
      for (const oldKeyStr in record) {
        const oldPos = Number(oldKeyStr);
        // fix for #144
        if (oldPos > changes.length) {
          changed = true;
          continue;
        }

        const newPos = changes.mapPos(oldPos);
        if (newPos !== oldPos) {
          changed = true;
        }
        if (newPos !== -1) {
          newRecord[String(newPos)] = record[oldKeyStr];
        }
      }

      this.permanentData[filePath] = newRecord;
    } else {
      const map = this.session.get(filePath);
      if (!map) {
        return false;
      }

      const newMap = new Map<K, V>();
      for (const [oldKey, value] of map.entries()) {
        const oldPos = Number(oldKey);
        // fix for #144
        if (oldPos > changes.length) {
          changed = true;
          continue;
        }

        const newPos = changes.mapPos(oldPos);
        if (newPos !== oldPos) {
          changed = true;
        }
        if (newPos !== -1) {
          newMap.set(this.keyParser(String(newPos)), value);
        }
      }

      this.session.set(filePath, newMap);
    }
    return changed;
  }// remap

  // remap entries where the key is NOT a position but the VALUE is (editor tabs: key = groupName, value = charPos). returns whether anything moved or was dropped
  remapValues(filePath: string, changes: ChangeSet): boolean {
    const entries = this.getAll(filePath);
    if (!entries) {
      return false;
    }

    let changed = false;
    for (const [key, value] of Array.from(entries)) {
      const oldPos = Number(value);
      // fix for #144
      if (oldPos > changes.length) {
        this.delete(filePath, key);
        changed = true;
        continue;
      }

      const newPos = changes.mapPos(oldPos);
      if (newPos !== oldPos) {
        this.set(filePath, key, newPos as V);
        changed = true;
      }
    }
    return changed;
  }// remapValues

  renamePath(oldPath: string, newPath: string): boolean {
    let changed = false;
    for (const [filePath, entries] of [...this.session.entries()]) {
      const renamed = renamedPath(filePath, oldPath, newPath);
      if (renamed !== null) {
        this.session.delete(filePath);
        this.session.set(renamed, entries);
        changed = true;
      }
    }

    for (const filePath of Object.keys(this.permanentData)) {
      const renamed = renamedPath(filePath, oldPath, newPath);
      if (renamed !== null) {
        const entries = this.permanentData[filePath];
        delete this.permanentData[filePath];
        this.permanentData[renamed] = entries;
        changed = true;
      }
    }

    return changed;
  }// renamePath

  deletePath(path: string): boolean {
    let changed = false;
    for (const filePath of [...this.session.keys()]) {
      if (isSameOrInside(filePath, path)) {
        this.session.delete(filePath);
        changed = true;
      }
    }

    for (const filePath of Object.keys(this.permanentData)) {
      if (isSameOrInside(filePath, path)) {
        delete this.permanentData[filePath];
        changed = true;
      }
    }

    return changed;
  }// deletePath
}// StateStore

function isSameOrInside(filePath: string, path: string): boolean {
  return filePath === path || filePath.startsWith(path + '/');
}// isSameOrInside

function renamedPath(filePath: string, oldPath: string, newPath: string): string | null {
  return isSameOrInside(filePath, oldPath) ? newPath + filePath.slice(oldPath.length) : null;
}// renamedPath
