#!/usr/bin/env bash

DB_INITIALISED="/opt/oracle/oradata/dbinit"
#[ -f ${DB_INITIALISED} ] && exit
#touch ${DB_INITIALISED}
if [ -f ${DB_INITIALISED} ]; then
  echo 'File exists. Standards for have been Init'
  exit
else
  echo 'File does not exist. Standards for first time Strart up this DB'
  "$ORACLE_HOME"/bin/sqlplus -s "/ as sysdba" @"/opt/oracle/scripts/startup/init_user.script"; 
  touch ${DB_INITIALISED}
fi
