export function migrate(db){db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT NOT NULL)')}
