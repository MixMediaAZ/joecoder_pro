export function createUser(db,name){return db.prepare('INSERT INTO users(fullname) VALUES(?)').run(name)}
