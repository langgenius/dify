#!/usr/bin/env bash

DB_INITIALIZED="/opt/oracle/oradata/dbinit"
#[ -f ${DB_INITIALIZED} ] && exit
#touch ${DB_INITIALIZED}
if [ -f ${DB_INITIALIZED} ]; then
  echo 'File exists. Standards for have been Init'
  exit
else
  echo 'File does not exist. Standards for first time Start up this DB'
  "$ORACLE_HOME"/bin/sqlplus -s "/ as sysdba" @"/opt/oracle/scripts/startup/init_user.script";
  touch ${DB_INITIALIZED}
fi
