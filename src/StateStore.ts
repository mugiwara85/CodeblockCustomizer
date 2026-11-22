import { ChangeSet } from "@codemirror/state";

type PermanentData<V> = Record<string, Record<string, V>>;

export class StateStore<K extends string | number, V> {
  private _isPermanent: boolean;
  private keyParser: (raw: string) => K;

  private session: Map<string, Map<K, V>> = new Map();
  private _permanentData: PermanentData<V> = {};

  constructor(isPermanent: boolean, keyParser: (raw: string) => K) {
    this._isPermanent = isPermanent;
    this.keyParser = keyParser;
  }

  get isPermanent(): boolean {
    return this._isPermanent;
  }

  set isPermanent(value: boolean) {
    this._isPermanent = value;
  }

  get permanentData(): PermanentData<V> {
    return this._permanentData;
  }

  set permanentData(data: PermanentData<V>) {
    this._permanentData = data;
  }

  // get single value
  get(filePath: string, key: K): V | undefined {
    if (this._isPermanent) {
      const record = this._permanentData[filePath];
      return record ? record[String(key)] : undefined;
    }
    return this.session.get(filePath)?.get(key);
  }// get

  // return all entries for a file as a Map. For permanent data, the record is converted to a Map
  getAll(filePath: string): Map<K, V> | undefined {
    if (this._isPermanent) {
      const record = this._permanentData[filePath];
      if (!record) {
        return undefined;
      }
      return new Map(Object.entries(record).map(([k, v]) => [this.keyParser(k), v]));
    }
    return this.session.get(filePath);
  }// getAll

  // set single value
  set(filePath: string, key: K, value: V): void {
    if (this._isPermanent) {
      if (!this._permanentData[filePath]) {
        this._permanentData[filePath] = {};
      }
      this._permanentData[filePath][String(key)] = value;
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
    if (this._isPermanent) {
      const record = this._permanentData[filePath];
      if (record) {
        delete record[String(key)];
        if (Object.keys(record).length === 0) {
          delete this._permanentData[filePath];
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
    this._permanentData = {};
  }// clear

  remap(filePath: string, changes: ChangeSet): boolean {
    let changed = false;
    if (this._isPermanent) {
      const record = this._permanentData[filePath];
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

      this._permanentData[filePath] = newRecord;
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
}// StateStore
