"use strict";
const fs = require("fs");
const fse = require("fs-extra");
const path = require("path");
const inquirer = require("inquirer");

function isDir(dir) {
  return new Promise((resolve, reject)=> {
    fs.lstat(dir, (err, stat)=> err ? reject(err) : resolve(stat.isDirectory()))
  });
}

function getDirs(dir) {
  return new Promise(
    (resolve, reject)=>
      fs.readdir(dir, (err, data)=> err ? reject(err) : resolve(data)))
    .then(
      (data)=> data.map((name)=> path.join(dir, name)))
    .then(
      (paths)=> {
        const isDirPath = (p)=> isDir(p).then((is)=> is ? p : null);
        return Promise.all(paths.map(isDirPath))
      })
    .then(
      (paths)=> paths.filter((p)=> p !== null))
}


function getConfig(nodeModules, searchFolders) {
  const nmDirs = getDirs(nodeModules);
  const dirs = searchFolders.map(
    (dir)=> getDirs(dir));
  return Promise.all([nmDirs].concat(dirs))
    .then((allDirs)=>
      [allDirs[0], allDirs.slice(1)]
    );
}

function rmdir(dirpath) {
  return new Promise((resolve, reject)=> {
    fse.rmdir(dirpath, (err, data)=> err ? reject(err) : resolve(data))
  });
}

function link(oldPath, newPath) {
  return new Promise((resolve, reject)=> {
    fse.ensureSymlink(oldPath, newPath,
      (err)=> err ? reject(err) : resolve(newPath));
  });
}

function rm(filepath) {
  return new Promise((resolve, reject)=> {
    fse.rm(filepath, (err, d)=> err ? reject(err) : resolve(d));
  });
}

function unlink(filepath) {
  return new Promise((resolve, reject)=> {
    fse.remove(filepath, (err, d)=> err ? reject(err) : resolve(d));
  });
}

function linkPkg(pkgPath, linkPath) {
  const oldName = path.basename(pkgPath);
  const oldRoot = path.dirname(pkgPath);
  const tmpPath = path.join(process.cwd(), ".tmp-pkg", oldName);
  return Promise.resolve()
    .then(()=> move(pkgPath, tmpPath))
    .then(()=> rmdir(pkgPath).catch(()=> {}))
    .then(()=> link(linkPath, pkgPath))
}

function unlinkPkg(pkgPath, linkPath) {
  return Promise.resolve()
    .then(()=> unlink(linkPath).catch(()=> {}))
    .then(()=> move(pkgPath, linkPath))
    .then(()=> rmdir(pkgPath).catch(()=> {}))
}

function move(oldPath, newPath) {
  return new Promise((resolve, reject)=> {
    fse.move(oldPath, newPath, (err, data)=> err ? reject(err) : resolve(data))
  });
}

function mkdir(filepath) {
  return new Promise((resolve, reject)=> {
    fs.mkdir(filepath, (err, data)=> err ? reject(err) : resolve(data))
  });
}

function interactiveLink(nodeModules, searchFolders, tmpPkg) {
  var prompt = inquirer.createPromptModule();
  return getConfig(nodeModules, searchFolders).then(
    (conf)=> {
      const nm = conf[0];
      const listdirs = conf[1];

      const pkgs = nm.reduce((memo, value)=> {
        const key = path.basename(value);
        !/^\./.test(key) && (memo[key] = value);
        return memo;
      }, {});

      const links = listdirs.reduce((memo, dirs)=> {
        if (memo.length > 0) {
          memo.push(new inquirer.Separator());
        }
        return memo.concat(dirs);
      }, []);

      return prompt({
        type: "checkbox",
        name: "pkgs",
        message: "Select modules for debug",
        default: [],
        choices: Object.keys(pkgs)
      }).then((answer)=> {

        function getChoises(name, list) {
          const top = list.filter((item)=> item.indexOf(name) >= 0);
          const down = list.filter((item)=> item.indexOf(name) < 0);
          return top.concat(down);
        }

        const questions = answer.pkgs.map((pkg)=> ({
          type: "list",
          name: pkg,
          message: `Select link for package ${pkg}`,
          default: "",
          choices: getChoises(pkg, links)
        }));
        return prompt(questions);
      }).then((answers)=> ({ links, pkgs, answers }));
    }
  ).then((config)=> {
      return mkdir(tmpPkg)
        .catch(()=> {})
        .then(()=> {
          const results = Object
            .keys(config.answers)
            .map((name)=> {
              const pkgPath = config.pkgs[name];
              const linkPath = config.answers[name];
              return linkPkg(pkgPath, linkPath);
            })
          return Promise.all(results)
        })
    });
}

function interactiveUnlink(nodeModules, tmpPkg) {
  var prompt = inquirer.createPromptModule();

  return getDirs(tmpPkg).then((dirs)=> {
    const pkgs = dirs.reduce((memo, value)=> {
      const key = path.basename(value);
      !/^\./.test(key) && (memo[key] = value);
      return memo;
    }, {});
    return prompt([{
      type: "checkbox",
      name: "pkgs",
      message: "Input message to unlink",
      default: [],
      choices: Object.keys(pkgs)
    }]).then((answers)=> {
      const results = answers.pkgs.map((pkg)=>
        unlinkPkg(pkgs[pkg], path.join(process.cwd(), "node_modules", pkg))
      )
      return Promise.all(results);
    }).then(()=> new Promise(
      (resolve)=> fs.rmdir(tmpPkg, ()=> resolve())
    ));
  })
}

module.exports = function main() {
  var prompt = inquirer.createPromptModule();
  const nodeModules = path.join(process.cwd(), "node_modules");
  const searchFolders = [
    path.join(process.cwd(), "..")
  ];
  const tmpPkg = path.join(process.cwd(), ".tmp-pkg");

  const app = prompt([{
    type: "list",
    name: "type",
    message: "Select action type.",
    choices: [
      "link",
      "unlink"
    ]
  }]).then((answer)=> {
    const name = answer.type;
    if (name === "link") {
      return interactiveLink(nodeModules, searchFolders, tmpPkg);
    } else if (name === "unlink") {
      return interactiveUnlink(nodeModules, tmpPkg);
    }
  })

  app.catch((err)=> {
    console.error(err);
    console.log(err.stack);
  });

  return app;
}
